import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CatalogueError,
  createRecommender,
  parseCatalogue,
  parseLeads,
  priceWithAddOns,
  type BusinessProfile,
  type Recommender,
} from "../src/lib/recommender";
import { eligibilityBlock } from "../src/lib/recommender/eligibility";
import { predictForest, trainForest } from "../src/lib/recommender/model/forest";

const ROOT = resolve(import.meta.dirname, "..");
const csv = readFileSync(resolve(ROOT, "product_catalogue.csv"), "utf8");
const leads = parseLeads(readFileSync(resolve(ROOT, "training_leads.csv"), "utf8"));
const won = leads.filter((l) => l.activated);
const catalogue = parseCatalogue(csv);
const FAST = { trees: 12 };

// Find products by what they are, so these tests survive catalogue edits too.
const byName = (name: string) => catalogue.products.find((p) => p.name === name)!.id;
const [fibre100, fibre300, fibre1g, airfiber, leased20, leased100] = ["Biz Fibre 100", "Biz Fibre 300", "Biz Fibre 1G", "Biz 5G AirFiber 100", "Internet Leased Line 20", "Internet Leased Line 100"].map(byName) as [string, string, string, string, string, string];
const [staticIp, sdwan, whatsapp, email, wifi, firewall, fleet, cctv] = ["Static IP", "Managed SD-WAN", "WhatsApp Business API Starter", "Cloud Email & Office Suite", "Secure Wi-Fi with Guest Network", "Managed Firewall", "Fleet Tracker", "Cloud CCTV"].map(byName) as [string, string, string, string, string, string, string, string];

const salon: BusinessProfile = { businessType: "Salon", employees: 4, sites: 1, cityTier: 1, hasGstin: true };
const lawOffice: BusinessProfile = { businessType: "Law office", employees: 12, sites: 1, cityTier: 1, hasGstin: true, monthlyTelecomSpend: 3000 };
const gym: BusinessProfile = { businessType: "Gym chain", employees: 60, sites: 6, cityTier: 1, hasGstin: true };
const press: BusinessProfile = { businessType: "Printing press", employees: 40, sites: 1, cityTier: 2, hasGstin: true };

let r: Recommender;
beforeAll(() => {
  r = createRecommender(catalogue, leads, FAST);
});
const ids = (p: BusinessProfile) => r.recommend(p).lines.map((l) => l.productId);
const linkOf = (rec: Recommender, p: BusinessProfile) => rec.recommend(p).lines.find((l) => l.role === "link")?.productId;
const recommended = (p: BusinessProfile) => r.recommend(p).addOns.filter((a) => a.recommendation).map((a) => a.productId);
const offered = (p: BusinessProfile) => r.recommend(p).addOns.map((a) => a.productId);
const flags = (p: BusinessProfile) => r.recommend(p).flags.map((f) => f.code);

/** Applies an edit to one product's row, by column name, as someone editing the spreadsheet would. */
function editCsv(id: string, column: string, value: string, text = csv): string {
  const lines = text.trimEnd().split(/\r?\n/);
  const columns = lines[0]!.split(",");
  const row = lines.findIndex((l) => l.startsWith(`${id},`));
  const cells = lines[row]!.match(/("[^"]*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, "")).slice(0, columns.length);
  cells[columns.indexOf(column)] = value;
  lines[row] = cells.join(",");
  return lines.join("\n");
}
const withoutProduct = (id: string) => csv.split(/\r?\n/).filter((l) => !l.startsWith(`${id},`)).join("\n");
const withProduct = (row: string) => `${csv.trimEnd()}\n${row}\n`;
const rebuild = (text: string) => createRecommender(parseCatalogue(text), leads, FAST);

describe("catalogue drives everything", () => {
  it("has no product ids in the source", () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const path = resolve(dir, f);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });
    for (const file of walk(resolve(ROOT, "src"))) expect(readFileSync(file, "utf8"), file).not.toMatch(/\bP\d{2}\b/);
  });
  it("derives each product's role from its columns", () => {
    const role = (name: string) => catalogue.products.find((p) => p.name === name)!.role;
    expect(catalogue.products.filter((p) => p.role === "link")).toHaveLength(6);
    expect(catalogue.products.filter((p) => p.role === "mobile")).toHaveLength(2);
    expect(role("Backup 4G/5G Failover")).toBe("add_on");
    expect(role("Managed SD-WAN")).toBe("add_on");
    expect(role("Static IP")).toBe("add_on");
  });
  it("derives fibre and speed from the wording", () => {
    const get = (id: string) => catalogue.byId.get(id)!;
    expect([fibre100, fibre300, fibre1g].every((id) => get(id).needsFibre)).toBe(true);
    expect(get(airfiber).needsFibre).toBe(false);
    expect(get(leased20).needsFibre).toBe(false);
    expect(get(fibre1g).speedMbps).toBe(1000);
    expect(get(leased20).speedMbps).toBe(20);
  });
  it("picks up a price change", () => {
    const rec = rebuild(editCsv(fibre300, "price_min_inr_per_month", "1234")).recommend(gym);
    const line = rec.lines.find((l) => l.productId === fibre300)!;
    expect(line.monthlyMin).toBe(1234 * line.quantity);
  });
  it("picks up a setup fee, contract and install change", () => {
    const edited = editCsv(fibre300, "typical_install_days", "9", editCsv(fibre300, "min_contract_months", "36", editCsv(fibre300, "one_time_setup_inr", "500")));
    const fresh = createRecommender(parseCatalogue(edited), leads, FAST).recommend(gym);
    expect(fresh.totals.setupFee).toBeGreaterThan(0);
    expect(fresh.totals.contractMonths).toBe(36);
    expect(fresh.totals.installDays).toBe(9);
  });
  it("stops recommending a removed product and doesn't crash", () => {
    const edited = createRecommender(parseCatalogue(withoutProduct(fibre300)), leads, FAST);
    const rec = edited.recommend(gym);
    expect(rec.lines.map((l) => l.productId)).not.toContain(fibre300);
    expect(rec.addOns.map((a) => a.productId)).not.toContain(fibre300);
    expect(rec.lines.some((l) => l.role === "link")).toBe(true);
    for (const lead of won) edited.recommend(lead.profile);
  });
  it("offers a new add-on with no code change, without recommending it", () => {
    const edited = rebuild(withProduct('P99,Security,Phishing Shield,"Email phishing protection for staff",per user,50,80,0,12,1;2,1,1,N,,1,prof;micro'));
    const option = edited.recommend(lawOffice).addOns.find((a) => a.name === "Phishing Shield")!;
    expect(option).toMatchObject({ recommendation: null, support: null, why: "Email phishing protection for staff" });
    expect(option.quantity).toBeGreaterThan(0);
    expect(option.monthlyMin).toBe(50 * option.quantity);
  });
  it("offers a new link as an alternative, and uses it if it's the only one allowed", () => {
    const row = 'P98,Connectivity,Biz Fibre 2G,"Business fibre broadband, 2 Gbps",per site,6000,7000,0,12,1;2,1,1,N,,7,prof';
    const edited = rebuild(withProduct(row));
    expect(edited.recommend(lawOffice).alternatives.map((a) => a.name)).toContain("Biz Fibre 2G");
    const heavy = edited.recommend({ ...lawOffice, cityTier: 2, heavyBandwidth: true });
    expect(heavy.lines[0]!.name).toBe("Biz Fibre 2G");
  });
  it("picks up a new city tier", () => {
    const edited = rebuild(editCsv(fibre1g, "available_city_tiers", "1;2"));
    expect(edited.recommend({ ...lawOffice, cityTier: 2, heavyBandwidth: true }).lines[0]!.productId).toBe(fibre1g);
  });
  it("picks up a target segment change", () => {
    const edited = rebuild(editCsv(fibre100, "target_segments", "micro;prof;multi"));
    const rec = edited.recommend(gym);
    expect([rec.lines[0]!.productId, ...rec.alternatives.map((a) => a.productId)]).toContain(fibre100);
  });
  it("picks up a new dependency", () => {
    const edited = rebuild(editCsv(staticIp, "requires_one_of", `${fibre100}|${fibre300}|${fibre1g}|${leased20}`));
    expect(edited.recommend(press).addOns.map((a) => a.productId)).toContain(staticIp);
  });
  it("rejects a broken catalogue with a clear error", () => {
    expect(() => parseCatalogue(csv.replace("product_name", "title"))).toThrow(/missing columns: product_name/);
    expect(() => parseCatalogue(editCsv(fibre100, "price_min_inr_per_month", "abc"))).toThrow(CatalogueError);
    expect(() => parseCatalogue(editCsv(fibre100, "requires_gstin", "maybe"))).toThrow(/requires_gstin/);
    expect(() => parseCatalogue(withProduct(csv.split(/\r?\n/)[1]!))).toThrow(/duplicate/);
    expect(() => parseCatalogue(csv.split(/\r?\n/)[0]!)).toThrow(/no products/);
    expect(() => parseCatalogue(withProduct("P96,Security,X,\"Y\",per site,1,2,0,1,1,1,1,N,,1"))).toThrow(/no value for target_segments/);
  });
  it("reads files saved by other tools: LF, CRLF, mixed endings and Excel's byte-order mark", () => {
    const expected = catalogue.products.length;
    expect(parseCatalogue(csv.replaceAll("\r\n", "\n")).products).toHaveLength(expected);
    expect(parseCatalogue(csv.replaceAll(/\r?\n/g, "\r\n")).products).toHaveLength(expected);
    expect(parseCatalogue(`\uFEFF${csv}`).products).toHaveLength(expected);
    expect(parseCatalogue(withProduct('P97,Security,X,"Y",per site,1,2,0,1,1,1,1,N,,1,prof')).products).toHaveLength(expected + 1);
  });
});

describe("segments and locations, from the leads", () => {
  it("classifies all 5,000 leads and knows every city", () => {
    expect(leads).toHaveLength(5000);
    expect(r.businessTypes).toHaveLength(35);
    const index = createRecommender(catalogue, leads, { kind: "frequency" });
    for (const l of leads) {
      expect(index.recommend(l.profile).segment).toBe(l.segment);
      expect(index.cityTierOf(l.city)).toBe(l.profile.cityTier);
    }
  });
  it("leaves unknown cities for the assistant to ask about", () => {
    expect(r.cityTierOf(" mumbai ")).toBe(1);
    expect(r.cityTierOf("Shimla")).toBeUndefined();
  });
  it("treats a real chain as multi-site and flags the inference", () => {
    const rec = r.recommend({ ...salon, employees: 20, sites: 5 });
    expect(rec.segment).toBe("multi");
    expect(rec.flags.map((f) => f.code)).toContain("segment_inferred");
  });
  it("keeps a many-site factory in manufacturing", () => {
    expect(r.recommend({ ...press, sites: 4 }).segment).toBe("mfg");
    expect(r.recommend({ ...press, businessType: "Garment factory", sites: 4 }).segment).toBe("mfg");
  });
  it("infers unknown types from wording, then size", () => {
    expect(r.recommend({ ...salon, businessType: "Accounting firm" }).segment).toBe("prof");
    expect(r.recommend({ ...salon, businessType: "Flower seller", employees: 2 }).segment).toBe("micro");
    expect(r.recommend({ ...salon, businessType: "Something", employees: 30 }).segment).toBe("prof");
  });
});

describe("hard constraints", () => {
  it("offers all 5,000 leads only what they can buy, in the bundle and the picker", () => {
    for (const lead of leads) {
      const rec = r.recommend(lead.profile);
      const chosen = new Set(rec.lines.map((l) => l.productId));
      for (const id of [...chosen, ...rec.addOns.map((a) => a.productId)]) {
        expect(eligibilityBlock(catalogue.byId.get(id)!, lead.profile, rec.segment, chosen), `${lead.id} ${id}`).toBeNull();
      }
    }
  });
  it("defaults multi-site to 300, never the untargeted 100", () => {
    for (const lead of won.filter((l) => l.segment === "multi")) {
      expect(linkOf(r, lead.profile)).toBe(fibre300);
    }
    expect(r.recommend(gym).alternatives.map((a) => a.productId)).not.toContain(fibre100);
  });
  it("blocks a stated need outside the segment's target", () => {
    const rec = r.recommend({ ...lawOffice, needs: { [fleet]: true } });
    expect(rec.addOns.map((a) => a.productId)).not.toContain(fleet);
    expect(rec.blocked).toEqual([expect.objectContaining({ productId: fleet, code: "segment" })]);
  });
  it("never offers 1G in tier 2, and says why when it was wanted", () => {
    const rec = r.recommend({ ...lawOffice, cityTier: 2, heavyBandwidth: true });
    expect(rec.lines[0]!.productId).not.toBe(fibre1g);
    expect(rec.blocked).toEqual([expect.objectContaining({ productId: fibre1g, code: "city_tier" })]);
  });
  it("blocks a GST-only need instead of silently dropping it", () => {
    const rec = r.recommend({ ...salon, hasGstin: false, needs: { [whatsapp]: true } });
    expect(rec.addOns.map((a) => a.productId)).not.toContain(whatsapp);
    expect(rec.blocked).toEqual([expect.objectContaining({ productId: whatsapp, code: "gstin" })]);
  });
  it("follows the catalogue: no static IP on a leased line", () => {
    const rec = r.recommend({ ...press, needs: { [staticIp]: true } });
    expect(rec.blocked[0]).toMatchObject({ productId: staticIp, code: "dependency" });
    expect(offered(press)).not.toContain(staticIp);
  });
  it("never recommends SD-WAN below its minimum sites", () => {
    expect(offered({ ...gym, businessType: "Bakery chain", sites: 2 })).not.toContain(sdwan);
  });
  it("uses wireless where there's no fibre, and drops what needs a fibre link", () => {
    const rec = r.recommend({ ...lawOffice, fibreAvailable: false });
    expect(rec.lines[0]!.productId).toBe(airfiber);
    expect(rec.addOns.map((a) => a.productId)).not.toContain(staticIp);
  });
  it("says so when no link fits, rather than inventing one", () => {
    const rec = r.recommend({ ...press, hasGstin: false });
    expect(rec.lines.some((l) => l.role === "link")).toBe(false);
    expect(rec.flags.map((f) => f.code)).toContain("no_eligible_link");
    expect(rec.blocked.map((b) => b.code)).toContain("gstin");
  });
});

describe("base bundle", () => {
  it("contains a link and a mobile plan, plus learned core items", () => {
    expect(r.recommend(salon).lines.map((l) => l.role)).toEqual(["link", "mobile"]);
    expect(r.recommend(lawOffice).lines.map((l) => l.role)).toEqual(["link", "mobile", "core"]);
    expect(r.recommend(gym).lines.map((l) => l.role)).toEqual(["link", "mobile"]);
    expect(ids(lawOffice)).toContain(email);
    expect(ids(press)).toContain(email);
  });
  it("chooses leased lines for manufacturers", () => {
    expect([leased20, leased100]).toContain(ids(press)[0]);
  });
  it("heavy bandwidth moves up to a faster, dearer link, not a slower leased line", () => {
    expect(linkOf(r, { ...lawOffice, heavyBandwidth: true })).toBe(fibre1g);
    expect(linkOf(r, { ...gym, cityTier: 2, heavyBandwidth: true })).toBe(fibre300);
  });
  it("never gives more lines or seats than people", () => {
    for (const line of r.recommend({ ...lawOffice, employees: 1 }).lines.filter((l) => ["per line", "per user"].includes(l.unit))) {
      expect(line.quantity).toBe(1);
    }
  });
  it("learns per-site quantities, and flags sites left uncovered", () => {
    expect(r.recommend(gym).lines[0]!.quantity).toBe(6);
    const twoSites = r.recommend({ ...lawOffice, sites: 2 });
    expect(twoSites.lines[0]!.quantity).toBe(1);
    expect(twoSites.flags.map((f) => f.code)).toContain("second_site_not_covered");
  });
  it("a declined core item leaves the bundle and joins the picker", () => {
    const profile = { ...lawOffice, needs: { [email]: false } };
    expect(ids(profile)).not.toContain(email);
    expect(offered(profile)).toContain(email);
  });
  it("keeps add-ons out of the totals", () => {
    const rec = r.recommend(gym);
    expect(rec.totals.monthlyMin).toBe(rec.lines.reduce((t, l) => t + l.monthlyMin, 0));
  });
});

describe("add-on picker", () => {
  it("recommends the learned typical number of add-ons", () => {
    expect([salon, lawOffice, gym, press].map((p) => recommended(p).length)).toEqual([1, 2, 3, 2]);
  });
  it("orders recommended rows first, by model score", () => {
    const rows = r.recommend(gym).addOns;
    const scores = rows.filter((a) => a.recommendation).map((a) => a.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(rows.findIndex((a) => !a.recommendation)).toBe(scores.length);
  });
  it("only recommends products with sales history in the segment", () => {
    for (const lead of won) for (const a of r.recommend(lead.profile).addOns) if (a.recommendation) expect(a.support).not.toBeNull();
  });
  it("offers every targeted product, even with no sales history", () => {
    expect(r.recommend(lawOffice).addOns.find((a) => a.productId === wifi)).toMatchObject({ recommendation: null, support: null });
  });
  it("recommends a stated need first and never selects it", () => {
    const rec = r.recommend({ ...salon, needs: { [cctv]: true } });
    expect(rec.addOns[0]).toMatchObject({ productId: cctv, recommendation: "stated_need" });
    expect(rec.lines.map((l) => l.productId)).not.toContain(cctv);
  });
  it("stated needs use up the recommendation slots", () => {
    expect(recommended({ ...salon, needs: { [cctv]: true } })).toEqual([cctv]);
  });
  it("a declined add-on stays pickable, at the bottom", () => {
    const declined = recommended(lawOffice)[0]!;
    const rec = r.recommend({ ...lawOffice, needs: { [declined]: false } });
    expect(rec.addOns.filter((a) => a.recommendation).map((a) => a.productId)).not.toContain(declined);
    expect(rec.addOns.at(-1)!.productId).toBe(declined);
  });
  it("recommends nothing once every add-on is declined", () => {
    const needs = Object.fromEntries(catalogue.products.map((p) => [p.id, false]));
    expect(r.recommend({ ...lawOffice, needs }).addOns.filter((a) => a.recommendation)).toEqual([]);
  });
  it("prices the picked add-ons on top of the base bundle", () => {
    const rec = r.recommend(press);
    const option = rec.addOns.find((a) => a.productId === firewall)!;
    const totals = priceWithAddOns(rec, [firewall]);
    expect(totals.monthlyMin).toBe(rec.totals.monthlyMin + option.monthlyMin);
    expect(totals.setupFee).toBe(rec.totals.setupFee + option.setupFee);
    expect(totals.contractMonths).toBe(catalogue.byId.get(firewall)!.minContractMonths);
    expect(priceWithAddOns(rec, [])).toEqual(rec.totals);
  });
  it("refuses to price an add-on the customer can't buy", () => {
    expect(() => priceWithAddOns(r.recommend(press), [staticIp])).toThrow(RangeError);
  });
});

describe("model", () => {
  const rows = Array.from({ length: 80 }, (_, i) => [i, i % 3]);
  const labels = rows.map(([x]) => (x! >= 40 ? 1 : 0));
  it("learns a simple boundary", () => {
    const forest = trainForest(rows, labels, { trees: 30, minLeaf: 2, seed: 1 });
    expect(predictForest(forest, [70, 0])).toBeGreaterThan(0.9);
    expect(predictForest(forest, [10, 0])).toBeLessThan(0.1);
  });
  it("is repeatable", () => {
    const train = () => trainForest(rows, labels, { trees: 5, minLeaf: 2, seed: 7 });
    expect(train()).toEqual(train());
  });
  it("gives the same result for the same profile, and handles missing fields", () => {
    expect(r.recommend(gym)).toEqual(r.recommend(gym));
    expect(() => r.recommend({ businessType: "Unknown", employees: 1, sites: 1, cityTier: 1, hasGstin: false })).not.toThrow();
  });
  it("can run the baseline instead", () => {
    const baseline = createRecommender(catalogue, leads, { kind: "frequency" });
    expect(new Set(won.filter((l) => l.segment === "micro").slice(0, 30).map((l) => linkOf(baseline, { ...l.profile })))).toEqual(new Set([fibre100]));
  });
});

describe("flags and validation", () => {
  it("marks sales-only flags as internal", () => {
    const rec = r.recommend({ ...salon, cityTier: 2, hasGstin: false, currentInternet: "Mobile hotspot" });
    const audience = (code: string) => rec.flags.find((f) => f.code === code)?.audience;
    expect(audience("retention_risk_first_business_link")).toBe("internal");
    expect(audience("kyc_risk_no_gstin")).toBe("internal");
    expect(audience("tier2_fibre_delivery_risk")).toBe("internal");
  });
  it("warns about churn only for micro and prof customers new to business links", () => {
    const code = "retention_risk_first_business_link";
    expect(flags({ ...salon, currentInternet: "Mobile hotspot" })).toContain(code);
    expect(flags({ ...salon, currentInternet: "Business broadband" })).not.toContain(code);
    expect(flags({ ...press, currentInternet: "Home broadband" })).not.toContain(code);
  });
  it("warns about tier 2 fibre, but not leased lines or tier 1", () => {
    expect(flags({ ...salon, cityTier: 2 })).toContain("tier2_fibre_delivery_risk");
    expect(flags(salon)).not.toContain("tier2_fibre_delivery_risk");
    expect(flags(press)).not.toContain("tier2_fibre_delivery_risk");
  });
  it("warns about long installs from the catalogue's install days", () => {
    expect(flags(press)).toContain("long_install");
    expect(flags(salon)).not.toContain("long_install");
  });
  it("rejects bad input", () => {
    expect(() => r.recommend({ ...salon, employees: 0 })).toThrow(RangeError);
    expect(() => r.recommend({ ...salon, sites: 1.5 })).toThrow(RangeError);
    expect(() => r.recommend({ ...salon, cityTier: 0 })).toThrow(RangeError);
  });
});
