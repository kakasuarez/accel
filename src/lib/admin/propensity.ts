import type { LeadStage } from "../leads/stages";
import type { Lead } from "../recommender/types";
import type { LeadSummary, Row } from "./metrics";

/**
 * Which of the leads the advisor couldn't close are worth a call, as a chance they'd activate.
 *
 * Deliberately simple, so a sales lead can read why a lead is near the top:
 *
 *   1. Start from how often a lead at that stage activated in the old sales-led process
 *      (training_leads.csv): 19% from needs assessed, 43% from an accepted quote, 63% after KYC.
 *   2. Adjust the odds for what the old leads say about the profile: segment, GSTIN, current internet.
 *      Each is the group's activation rate against the average, smoothed so small groups count less.
 *   3. Halve the odds for every two weeks the lead has sat untouched past the stall line, and again
 *      if its latest KYC check was rejected. These two are judgement calls: the old leads have no dates
 *      or KYC results to learn them from.
 *
 * It ranks; it isn't calibrated. Retrain it on the app's own leads once enough have settled.
 */

/** Leads with no movement for this long are counted as ones the advisor couldn't close. */
export const STALL_DAYS = 3;
const HALF_LIFE_DAYS = 14;
const KYC_REJECTED = 0.5;
/** Pretend every group has this many extra leads at the average rate, so a group of 5 can't swing the score. */
const SMOOTHING = 40;
/** Factors smaller than this aren't worth listing as a reason. */
const NOTABLE = 1.15;
const CALL_LIST_SIZE = 12;

const DAY = 24 * 60 * 60 * 1000;
type OpenStage = Exclude<LeadStage, "Activated">;
const OPEN_STAGES: readonly OpenStage[] = ["Needs assessed", "Quote accepted", "KYC complete"];
/** The same stages in training_leads.csv's FUNNEL_STAGES. */
const TRAINING_INDEX: Record<OpenStage, number> = { "Needs assessed": 2, "Quote accepted": 3, "KYC complete": 4 };

export interface PropensityModel {
  /** Share that activated, of the old leads that reached each stage. */
  base: Record<OpenStage, number>;
  /** Odds multipliers. A value the old leads never had gets 1. */
  segment: ReadonlyMap<string, number>;
  gstin: ReadonlyMap<boolean, number>;
  internet: ReadonlyMap<string, number>;
}

const odds = (p: number) => p / (1 - p);
const fromOdds = (o: number) => o / (1 + o);

/** Learns the base rates and profile factors from the old sales-led leads. */
export function trainPropensity(history: readonly Lead[]): PropensityModel {
  const assessed = history.filter((l) => l.stage >= TRAINING_INDEX["Needs assessed"]);
  const rateOf = (group: readonly Lead[]) => group.filter((l) => l.activated).length / group.length;
  const average = rateOf(assessed);

  const factors = <K>(key: (l: Lead) => K) => {
    const groups = new Map<K, Lead[]>();
    for (const lead of assessed) groups.set(key(lead), [...(groups.get(key(lead)) ?? []), lead]);
    return new Map(
      [...groups].map(([k, group]) => {
        const smoothed = (group.filter((l) => l.activated).length + SMOOTHING * average) / (group.length + SMOOTHING);
        return [k, odds(smoothed) / odds(average)];
      }),
    );
  };

  return {
    base: Object.fromEntries(OPEN_STAGES.map((s) => [s, rateOf(history.filter((l) => l.stage >= TRAINING_INDEX[s]))])) as Record<OpenStage, number>,
    segment: factors((l) => l.segmentLabel),
    gstin: factors((l) => l.profile.hasGstin),
    internet: factors((l) => l.profile.currentInternet ?? "None"),
  };
}

/** How much better or worse than average the profile alone makes a lead, as an odds multiplier. */
export function profileLift(model: PropensityModel, profile: { segment: string | null; hasGstin: boolean | null; currentInternet: string | null }): number {
  return profileFactors(model, profile).reduce((total, f) => total * f.factor, 1);
}

interface Factor {
  label: string;
  factor: number;
}

function profileFactors(model: PropensityModel, p: { segment: string | null; hasGstin: boolean | null; currentInternet: string | null }): Factor[] {
  const factors: Factor[] = [];
  if (p.segment) factors.push({ label: p.segment, factor: model.segment.get(p.segment) ?? 1 });
  if (p.hasGstin !== null) factors.push({ label: p.hasGstin ? "Has GSTIN" : "No GSTIN", factor: model.gstin.get(p.hasGstin) ?? 1 });
  if (p.currentInternet) factors.push({ label: `Now on ${p.currentInternet.toLowerCase()}`, factor: model.internet.get(p.currentInternet) ?? 1 });
  return factors;
}

export interface Reason {
  label: string;
  effect: "up" | "down";
}

export interface CallLead {
  id: string;
  /** Business name once the quote is accepted, otherwise the business type and city. */
  business: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  stage: OpenStage;
  idleDays: number;
  monthly: number | null;
  /** 0–1: the chance this lead activates if someone picks it up. */
  score: number;
  band: "High" | "Medium" | "Low";
  /** What moved the score most, biggest first. */
  reasons: Reason[];
}

export interface CallList {
  /** Every open lead stalled for STALL_DAYS or more. */
  total: number;
  byStage: Row[];
  /** Monthly value of the stalled leads that have accepted a quote. */
  monthlyAtStake: number;
  /** The best to call first. */
  top: CallLead[];
}

const band = (score: number): CallLead["band"] => (score >= 0.4 ? "High" : score >= 0.2 ? "Medium" : "Low");

export function scoreLead(model: PropensityModel, lead: LeadSummary, now: Date): CallLead | null {
  if (lead.status !== "open" || !lead.stage || lead.stage === "Activated") return null;
  const idleDays = Math.floor((now.getTime() - lead.lastActivityAt.getTime()) / DAY);
  if (idleDays < STALL_DAYS) return null;

  const factors = profileFactors(model, { segment: lead.segment, ...lead.profile });
  if (idleDays > STALL_DAYS) factors.push({ label: `${idleDays} days without activity`, factor: 0.5 ** ((idleDays - STALL_DAYS) / HALF_LIFE_DAYS) });
  if (lead.kyc?.decision === "REJECT") factors.push({ label: "KYC rejected", factor: KYC_REJECTED });
  if (lead.kyc?.decision === "MANUAL_REVIEW") factors.push({ label: "KYC waiting on review", factor: 1 });

  const score = fromOdds(factors.reduce((o, f) => o * f.factor, odds(model.base[lead.stage])));
  const reasons = factors
    .filter((f) => Math.max(f.factor, 1 / f.factor) >= NOTABLE || f.label.startsWith("KYC"))
    .sort((a, b) => Math.abs(Math.log(b.factor)) - Math.abs(Math.log(a.factor)))
    .map((f): Reason => ({ label: f.label, effect: f.factor >= 1 ? "up" : "down" }));

  return {
    id: lead.id,
    business: lead.contact.business ?? ([lead.profile.businessType, lead.profile.city].filter(Boolean).join(", ") || "Unnamed business"),
    contactName: lead.contact.name,
    phone: lead.contact.phone,
    email: lead.contact.email,
    stage: lead.stage,
    idleDays,
    monthly: lead.monthly,
    score,
    band: band(score),
    reasons,
  };
}

/** The stalled leads, best to call first: highest chance, then the biggest monthly value. */
export function callList(model: PropensityModel, leads: readonly LeadSummary[], now: Date, size = CALL_LIST_SIZE): CallList {
  const stalled = leads.flatMap((l) => scoreLead(model, l, now) ?? []);
  stalled.sort((a, b) => b.score - a.score || (b.monthly ?? 0) - (a.monthly ?? 0) || a.id.localeCompare(b.id));
  return {
    total: stalled.length,
    byStage: OPEN_STAGES.map((stage) => {
      const group = stalled.filter((l) => l.stage === stage);
      const high = group.filter((l) => l.band === "High").length;
      return { label: `Stuck at ${stage}`, value: group.length, detail: `${high} worth calling first` };
    }),
    monthlyAtStake: stalled.reduce((total, l) => total + (l.monthly ?? 0), 0),
    top: stalled.slice(0, size),
  };
}
