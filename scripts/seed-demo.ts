/**
 * Fills the database with made-up leads so every admin dashboard metric has something to show.
 *
 *   npm run seed:demo            replaces the demo data with a fresh set
 *   npm run seed:demo -- --remove  deletes it
 *   npm run seed:demo -- --dry-run prints the KPIs the data would give, without touching the database
 *
 * All demo leads belong to one account, DEMO_EMAIL. Deleting that account deletes its leads, stage
 * events and KYC checks with it, so real data is never touched. Profiles are real rows from
 * training_leads.csv and quotes are built by the real recommender, so the numbers look like real ones.
 * The data is dated relative to today and spread over the last 180 days, which covers the 90-day
 * view and the 90 days before it.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { buildKpis } from "../src/lib/admin/kpis";
import { PERIODS, type LeadSummary } from "../src/lib/admin/metrics";
import { profileLift, trainPropensity } from "../src/lib/admin/propensity";
import { db } from "../src/lib/db";
import { REASONS } from "../src/lib/kyc/reasons";
import type { Decision, DocType } from "../src/lib/kyc/types";
import { bundleOptions, priceSelection, type BundleTier } from "../src/lib/leads/quote";
import type { AcceptedQuote } from "../src/lib/leads/repository";
import { LEAD_STAGES, type LeadStage } from "../src/lib/leads/stages";
import { buildQuestions } from "../src/lib/questions/build";
import type { Answers } from "../src/lib/questions/types";
import { parseLeads } from "../src/lib/recommender";
import { loadRecommender } from "../src/lib/recommender/server";

process.loadEnvFile(".env.local");
const DEMO_EMAIL = "demo-data@accel.example";
const LEADS = 460;
const SPAN_DAYS = 180;
const DAY = 24 * 60 * 60 * 1000;

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};
const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SECRET_KEY"), { auth: { persistSession: false } });

// Seeded, so each run gives the same shape of data (shifted to today).
let seed = 20261108;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const chance = (p: number) => random() < p;
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
const between = (min: number, max: number) => min + random() * (max - min);
function weighted<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  let roll = random() * entries.reduce((t, [, w]) => t + w, 0);
  for (const [key, w] of entries) if ((roll -= w) <= 0) return key;
  return entries[0]![0];
}

const FIRST = ["Aarav", "Priya", "Rohan", "Ananya", "Vikram", "Sneha", "Arjun", "Kavya", "Rahul", "Meera", "Siddharth", "Isha", "Karan", "Pooja", "Nikhil", "Divya"];
const LAST = ["Sharma", "Iyer", "Patel", "Reddy", "Gupta", "Nair", "Mehta", "Khan", "Joshi", "Das", "Kulkarni", "Singh", "Menon", "Bose", "Chopra", "Rao"];
const CLOSE_REASONS: Record<"early" | "quoted" | "kyc", Record<string, number>> = {
  early: { "Went with another provider": 4, "Price too high": 3, "Not reachable after three calls": 3, "Business not ready yet": 2, "Duplicate lead": 1 },
  quoted: { "Went with another provider": 3, "Price too high": 2, "No fibre at the site": 2, "Not reachable after three calls": 1 },
  kyc: { "KYC documents didn't match": 4, "Customer stopped responding during KYC": 2, "Went with another provider": 1 },
};

async function removeDemoUser(): Promise<boolean> {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((u) => u.email === DEMO_EMAIL);
    if (user) {
      const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
      if (deleteError) throw deleteError;
      return true;
    }
    if (data.users.length < 1000) return false;
  }
}

/** Stored the way the KYC route stores findings: code, severity, document and message only. */
const finding = (code: keyof typeof REASONS, doc?: DocType) => ({ code, severity: REASONS[code].severity, ...(doc ? { doc } : {}), message: REASONS[code].message });

/** The KPI tiles each period would show, worked out the way the admin page does. */
function printKpis(leads: Record<string, unknown>[], events: Record<string, unknown>[], checks: Record<string, unknown>[], now: number) {
  const summaries = leads.map((lead) => {
    const reached: LeadSummary["reached"] = {};
    for (const e of events.filter((e) => e.lead_id === lead.id)) reached[e.stage as LeadStage] ??= new Date(e.created_at as string);
    const first = checks.find((c) => c.lead_id === lead.id);
    return { reached, createdAt: new Date(lead.created_at as string), firstKyc: first ? { decision: first.decision, at: new Date(first.created_at as string) } : null } as LeadSummary;
  });
  for (const days of PERIODS) {
    const start = now - days * DAY;
    const window = (from: number, to: number) => (d: Date | null | undefined) => !!d && d.getTime() > from && d.getTime() <= to;
    const kpis = buildKpis(summaries, window(start, now), window(start - days * DAY, start));
    const shown = kpis.filter((k) => k.current.value !== null);
    const line = shown.map((k) => `${k.label} ${k.unit === "percent" ? `${Math.round(k.current.value! * 100)}%` : Math.round(k.current.value!)} ${k.onTarget ? "✓" : "✗"}`);
    console.log(`${days} days: ${shown.filter((k) => k.onTarget).length}/${shown.length} on target · ${line.join(" · ")}`);
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const removed = dryRun ? false : await removeDemoUser();
  if (process.argv.includes("--remove")) {
    console.log(removed ? `Deleted ${DEMO_EMAIL} and all of its demo leads.` : "There was no demo data to delete.");
    return;
  }
  if (removed) console.log("Replaced the previous demo data.");

  let userId = "dry-run";
  if (!dryRun) {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: randomUUID(),
      email_confirm: true,
      user_metadata: { demo: true },
    });
    if (error) throw error;
    userId = created.user.id;
  }

  const recommender = loadRecommender();
  const questions = buildQuestions(recommender);
  const samples = parseLeads(readFileSync("training_leads.csv", "utf8"));
  const propensity = trainPropensity(samples);
  const now = Date.now();

  const leads: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const checks: Record<string, unknown>[] = [];

  for (let i = 0; i < LEADS; i++) {
    const id = randomUUID();
    // Volume grows over time: more leads in recent weeks than six months ago.
    const createdAt = now - SPAN_DAYS * DAY * (1 - Math.sqrt(random()));
    const sample = pick(samples);
    const p = sample.profile;
    const answers: Answers = {
      businessType: p.businessType,
      employees: p.employees,
      sites: p.sites,
      city: sample.city,
      hasGstin: p.hasGstin,
      currentInternet: p.currentInternet ?? null,
      monthlyTelecomSpend: p.monthlyTelecomSpend ?? null,
      heavyBandwidth: chance(0.35),
    };
    const options = bundleOptions(recommender, questions, answers);
    if (!options) throw new Error(`Couldn't build a quote for sample ${sample.id}`);
    const sensitivity = recommender.priceSensitivity(options[0]!.recommendation.segment);
    // Profiles that did well in the old process do well here too, so the call list's ranking means something.
    const lift = Math.sqrt(profileLift(propensity, { segment: sample.segmentLabel, hasGstin: p.hasGstin, currentInternet: p.currentInternet ?? null }));
    const likelier = (base: number) => Math.min(0.97, base * lift);

    const timeline: { stage: LeadStage; at: number }[] = [{ stage: "Needs assessed", at: createdAt + between(5, 25) * 60_000 }];
    let quote: AcceptedQuote | null = null;
    // KYC attempts, oldest first. A failed first check is often fixed with better documents a day or two later.
    let attempts: { decision: Decision; at: number }[] = [];

    if (chance(likelier(0.64))) {
      const weights: Record<BundleTier, number> =
        sensitivity === "high" ? { recommended: 5, budget: 4, premium: 1 } : sensitivity === "low" ? { recommended: 5, budget: 1, premium: 3 } : { recommended: 6, budget: 2, premium: 2 };
      const offered = Object.fromEntries(options.map((o) => [o.tier, weights[o.tier]])) as Record<BundleTier, number>;
      const tier = weighted(offered);
      const option = options.find((o) => o.tier === tier)!;
      const ticked = option.recommendation.addOns.filter((a) => a.recommendation && chance(0.55)).map((a) => a.productId);
      const priced = priceSelection(option.recommendation, ticked, recommender.catalogue);
      quote = { recommendation: option.recommendation, bundle: option.tier, selectedAddOns: priced.selectedAddOns, totals: priced.totals };
      timeline.push({ stage: "Quote accepted", at: timeline[0]!.at + between(0.02, 1.5) * DAY });

      if (chance(0.88)) {
        attempts.push({ decision: weighted<Decision>({ APPROVE: 86, MANUAL_REVIEW: 9, REJECT: p.hasGstin ? 4 : 14 }), at: timeline[1]!.at + between(0.1, 2) * DAY });
        if (attempts[0]!.decision !== "APPROVE" && chance(0.55)) {
          attempts.push({ decision: weighted<Decision>({ APPROVE: 85, MANUAL_REVIEW: 10, REJECT: 5 }), at: attempts[0]!.at + between(0.5, 3) * DAY });
        }
        const approved = attempts.find((a) => a.decision === "APPROVE");
        if (approved) {
          timeline.push({ stage: "KYC complete", at: approved.at });
          if (chance(likelier(0.9))) timeline.push({ stage: "Activated", at: approved.at + between(1.5, Math.max(2.5, option.recommendation.totals.installDays)) * DAY });
        }
      }
    }

    // Only what has happened by now: recent leads are still part-way through.
    const happened = timeline.filter((t) => t.at <= now);
    attempts = attempts.filter((a) => a.at <= now);
    const kyc = attempts.at(-1) ?? null;
    const last = happened.at(-1)!;
    const stage = last.stage;

    let closedAt: number | null = null;
    let closeReason: string | null = null;
    if (stage !== "Activated") {
      const kind = kyc?.decision === "REJECT" ? "kyc" : stage === "Needs assessed" ? "early" : stage === "Quote accepted" && kyc ? "kyc" : "quoted";
      const closeChance = kind === "kyc" ? 0.6 : kind === "early" ? 0.5 : 0.35;
      const at = last.at + between(3, 20) * DAY;
      if (at <= now && chance(closeChance)) {
        closedAt = at;
        closeReason = weighted(CLOSE_REASONS[kind]);
      }
    }

    const first = pick(FIRST);
    const surname = pick(LAST);
    const accepted = LEAD_STAGES.indexOf(stage) >= LEAD_STAGES.indexOf("Quote accepted");
    leads.push({
      id,
      user_id: userId,
      answers,
      stage,
      status: closedAt ? "closed" : "open",
      close_reason: closeReason,
      business_name: accepted ? `${surname} ${p.businessType}` : null,
      contact_name: accepted ? `${first} ${surname}` : null,
      phone: accepted ? `+91 9${String(Math.floor(random() * 1e9)).padStart(9, "0")}` : null,
      quote: accepted ? quote : null,
      created_at: new Date(createdAt).toISOString(),
      updated_at: new Date(closedAt ?? last.at).toISOString(),
    });
    for (const t of happened) events.push({ lead_id: id, stage: t.stage, status: "open", created_at: new Date(t.at).toISOString() });
    if (closedAt) events.push({ lead_id: id, stage, status: "closed", created_at: new Date(closedAt).toISOString() });
    for (const attempt of attempts) {
      const findings =
        attempt.decision === "APPROVE"
          ? []
          : attempt.decision === "MANUAL_REVIEW"
            ? [pick([finding("LOW_OCR_CONFIDENCE", "gst_certificate"), finding("DOC_TYPE_MISMATCH", "address_proof"), finding("GSTIN_MISSING", "gst_certificate")])]
            : [pick([finding("DOC_MISSING_SIGNATORY_ID"), finding("DOC_UNREADABLE", "address_proof"), finding("NO_BUSINESS_PROOF")])];
      checks.push({ lead_id: id, user_id: userId, decision: attempt.decision, findings, created_at: new Date(attempt.at).toISOString() });
    }
  }

  if (dryRun) {
    printKpis(leads, events, checks, now);
    return;
  }

  const sql = db();
  await sql.begin(async (tx) => {
    await tx`
      insert into leads (id, user_id, answers, stage, status, close_reason, business_name, contact_name, phone, quote, created_at, updated_at)
      select id, user_id, answers, stage, status, close_reason, business_name, contact_name, phone, quote, created_at, updated_at
      from jsonb_to_recordset(${sql.json(leads as never)}) as x(id uuid, user_id uuid, answers jsonb, stage text, status text, close_reason text,
        business_name text, contact_name text, phone text, quote jsonb, created_at timestamptz, updated_at timestamptz)`;
    await tx`
      insert into lead_events (lead_id, stage, status, created_at)
      select lead_id, stage, status, created_at
      from jsonb_to_recordset(${sql.json(events as never)}) as x(lead_id uuid, stage text, status text, created_at timestamptz)
      order by created_at`;
    await tx`
      insert into kyc_checks (lead_id, user_id, decision, findings, created_at)
      select lead_id, user_id, decision, findings, created_at
      from jsonb_to_recordset(${sql.json(checks as never)}) as x(lead_id uuid, user_id uuid, decision text, findings jsonb, created_at timestamptz)
      order by created_at`;
  });
  await sql.end();

  const count = (stage: LeadStage) => leads.filter((l) => l.stage === stage).length;
  console.log(`Added ${leads.length} demo leads for ${DEMO_EMAIL}: ${LEAD_STAGES.map((s) => `${count(s)} ${s}`).join(", ")}.`);
  console.log(`${leads.filter((l) => l.status === "closed").length} closed, ${checks.length} KYC checks. Remove with: npm run seed:demo -- --remove`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
