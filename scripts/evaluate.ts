/**
 * Scores the recommender on leads it wasn't trained on. Run: npm run evaluate
 *
 * Profiles carry only pre-sale fields and no stated needs, because the leads
 * don't record them. "Bundle" means the base bundle plus every recommended
 * add-on, as if the customer accepted them all. Dropped leads have no bundle
 * to compare against, so they're only used for the compliance check.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRecommender, parseCatalogue, parseLeads, priceWithAddOns, type Lead, type Recommendation, type Recommender } from "../src/lib/recommender";
import { eligibilityBlock } from "../src/lib/recommender/eligibility";

const read = (file: string) => readFileSync(resolve(import.meta.dirname, "..", file), "utf8");
const catalogue = parseCatalogue(read("product_catalogue.csv"));
const allLeads = parseLeads(read("training_leads.csv"));
const won = allLeads.filter((l) => l.activated);
const roleOf = (id: string) => catalogue.byId.get(id)?.role;

interface Tally {
  link: [number, number]; mobile: [number, number]; profMobile: [number, number];
  addOnHit: number; addOnPicked: number; addOnSold: number; bundleHit: number; bundlePicked: number; bundleSold: number;
}
const emptyTally = (): Tally => ({ link: [0, 0], mobile: [0, 0], profMobile: [0, 0], addOnHit: 0, addOnPicked: 0, addOnSold: 0, bundleHit: 0, bundlePicked: 0, bundleSold: 0 });

/** Sold links the catalogue allows: a forbidden sale can't count against a model that's barred from repeating it. */
function legalSoldLink(lead: Lead) {
  return [...lead.bundle.keys()].find((id) => {
    const product = catalogue.byId.get(id);
    return product?.role === "link" && !eligibilityBlock(product, lead.profile, lead.segment);
  });
}

function score(test: Lead[], recommender: Recommender, t: Tally) {
  for (const lead of test) {
    const r = recommender.recommend(lead.profile);
    const linkPick = r.lines.find((l) => l.role === "link")?.productId;
    const mobilePick = r.lines.find((l) => l.role === "mobile")?.productId;
    const soldLink = legalSoldLink(lead);
    if (soldLink) { t.link[0] += linkPick === soldLink ? 1 : 0; t.link[1]++; }
    const hitMobile = mobilePick !== undefined && lead.bundle.has(mobilePick) ? 1 : 0;
    t.mobile[0] += hitMobile; t.mobile[1]++;
    if (lead.segment === "prof") { t.profMobile[0] += hitMobile; t.profMobile[1]++; }

    const recommended = r.addOns.filter((a) => a.recommendation).map((a) => a.productId);
    const coreIds = new Set(r.lines.map((l) => l.productId));
    t.addOnPicked += recommended.length;
    t.addOnHit += recommended.filter((id) => lead.bundle.has(id)).length;
    t.addOnSold += [...lead.bundle.keys()].filter((id) => roleOf(id) === "add_on" && !coreIds.has(id)).length;
    const picked = [...coreIds, ...recommended];
    t.bundlePicked += picked.length;
    t.bundleSold += lead.bundle.size;
    t.bundleHit += picked.filter((id) => lead.bundle.has(id)).length;
  }
}

function report(name: string, t: Tally) {
  const pct = ([a, b]: [number, number]) => (a / b).toFixed(3);
  const p = t.bundleHit / t.bundlePicked, r = t.bundleHit / t.bundleSold;
  console.log(`${name.padEnd(30)} link ${pct(t.link)}  mobile ${pct(t.mobile)}  prof mobile ${pct(t.profMobile)}  add-on P ${(t.addOnHit / t.addOnPicked).toFixed(3)} R ${(t.addOnHit / t.addOnSold).toFixed(3)}  bundle F1 ${((2 * p * r) / (p + r)).toFixed(3)}`);
}

function crossValidate(kind: "forest" | "frequency", folds: number, repeats: number) {
  const tally = emptyTally();
  for (let repeat = 0; repeat < repeats; repeat++) {
    // Deterministic shuffle by hashing id and repeat, so both models see identical folds.
    const order = allLeads
      .map((lead, i) => ({ lead, key: Math.imul(i + 1, 2654435761 + repeat * 40503) >>> 0 }))
      .sort((a, b) => a.key - b.key);
    for (let fold = 0; fold < folds; fold++) {
      const train = order.filter((_, i) => i % folds !== fold).map((x) => x.lead);
      const test = order.filter((x, i) => i % folds === fold && x.lead.activated).map((x) => x.lead);
      score(test, createRecommender(catalogue, train, { kind, trees: 80, seed: fold + repeat * 100 + 1 }), tally);
    }
  }
  return tally;
}

console.log(`=== Cross-validated on held-out activated leads (${won.length}, 5 folds, 2 repeats) ===`);
report("Segment frequency baseline", crossValidate("frequency", 5, 2));
report("Random forest", crossValidate("forest", 5, 2));

console.log("\n=== Time split: trained on Apr-May, tested on June ===");
const train = allLeads.filter((l) => l.created < "2026-06-01");
const june = won.filter((l) => l.created >= "2026-06-01");
for (const kind of ["frequency", "forest"] as const) {
  const tally = emptyTally();
  score(june, createRecommender(catalogue, train, { kind }), tally);
  report(kind === "forest" ? "Random forest" : "Segment frequency baseline", tally);
}

const full = createRecommender(catalogue, allLeads);
console.log("\n=== Add-on picker, final model ===");
let inPicker = 0, soldAddOns = 0, pickerSize = 0;
for (const lead of won) {
  const r = full.recommend(lead.profile);
  const inBundle = new Set(r.lines.map((l) => l.productId));
  const offered = new Set(r.addOns.map((a) => a.productId));
  pickerSize += r.addOns.length;
  for (const id of lead.bundle.keys()) {
    if (roleOf(id) !== "add_on" || inBundle.has(id)) continue;
    soldAddOns++;
    if (offered.has(id)) inPicker++;
  }
}
console.log(`${(pickerSize / won.length).toFixed(1)} options on average; holds ${(inPicker / soldAddOns).toFixed(3)} of add-ons really sold`);

console.log("\n=== Quantities, where recommended and sold both include the product ===");
let same = 0, near = 0, n = 0;
for (const lead of won) {
  const r = full.recommend(lead.profile);
  for (const item of [...r.lines, ...r.addOns]) {
    const real = lead.bundle.get(item.productId);
    if (real === undefined) continue;
    n++;
    if (real === item.quantity) same++;
    if (Math.abs(real - item.quantity) <= 1) near++;
  }
}
console.log(`exact ${(same / n).toFixed(3)}, within 1 ${(near / n).toFixed(3)} (n=${n})`);

console.log("\n=== Business checks, all leads ===");
let violations = 0, noLink = 0;
const ratios: number[] = [];
for (const lead of allLeads) {
  const r: Recommendation = full.recommend(lead.profile);
  const chosen = new Set(r.lines.map((l) => l.productId));
  const segment = r.segment;
  for (const id of [...chosen, ...r.addOns.map((a) => a.productId)]) {
    if (eligibilityBlock(catalogue.byId.get(id)!, lead.profile, segment, chosen)) violations++;
  }
  if (!r.lines.some((l) => l.role === "link")) noLink++;
  if (lead.activated) {
    const accepted = priceWithAddOns(r, r.addOns.filter((a) => a.recommendation).map((a) => a.productId));
    ratios.push(accepted.monthly / lead.monthlyValue);
  }
}
ratios.sort((a, b) => a - b);
console.log(`Catalogue violations: ${violations}. Leads with no eligible link: ${noLink}/${allLeads.length}.`);
console.log(`Recommended vs real monthly value: median ${ratios[Math.floor(ratios.length / 2)]!.toFixed(2)}, p10 ${ratios[Math.floor(ratios.length * 0.1)]!.toFixed(2)}, p90 ${ratios[Math.floor(ratios.length * 0.9)]!.toFixed(2)}`);
