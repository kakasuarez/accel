import type { Decision as KycDecision } from "../kyc/types";
import { LEAD_STAGES, type LeadStage } from "../leads/stages";
import type { BundleTier } from "../leads/quote";
import { buildKpis, type Kpi } from "./kpis";

/** One lead, reduced to what the metrics need. Built from the database in ./data.ts. */
export interface LeadSummary {
  id: string;
  createdAt: Date;
  stage: LeadStage | null;
  status: "open" | "closed";
  closeReason: string | null;
  closedAt: Date | null;
  /** Segment label, e.g. "Professional offices". Null when the profile isn't complete. */
  segment: string | null;
  /** Null when no quote was accepted. Quotes accepted before bundle options existed have no tier. */
  bundle: BundleTier | "unrecorded" | null;
  /** Monthly price of the accepted quote. */
  monthly: number | null;
  /** When the lead first reached each stage. */
  reached: Partial<Record<LeadStage, Date>>;
  /** The newest KYC attempt. */
  kyc: { decision: KycDecision; at: Date } | null;
  /** The first KYC attempt, the same as `kyc` when there was only one. */
  firstKyc: { decision: KycDecision; at: Date } | null;
}

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export interface Compared {
  current: number;
  previous: number;
}

export interface Row {
  label: string;
  value: number;
  /** Optional second line, e.g. "8 activated · 24%". */
  detail?: string;
}

export interface FunnelStep {
  stage: LeadStage;
  count: number;
  /** Share of the step before that reached this one; null for the first step. */
  fromPrevious: number | null;
}

export interface AdminMetrics {
  days: Period;
  newLeads: Compared;
  activations: Compared;
  /** The KPIs with targets, see ./kpis.ts. */
  kpis: Kpi[];
  revenueWon: Compared;
  averageWon: Compared;
  pipeline: { leads: number; monthly: number };
  funnel: FunnelStep[];
  bundles: Row[];
  segments: Row[];
  kyc: Row[];
  closedReasons: Row[];
  closedStages: Row[];
  closedTotal: number;
}

const DAY = 24 * 60 * 60 * 1000;
const TIER_LABELS: Record<NonNullable<LeadSummary["bundle"]>, string> = {
  recommended: "Recommended",
  budget: "Budget",
  premium: "Premium",
  unrecorded: "Not recorded",
};
const KYC_LABELS: Record<KycDecision, string> = { APPROVE: "Approved", MANUAL_REVIEW: "Manual review", REJECT: "Rejected" };
/** Close reasons are free text, so only the most common are listed and the rest are grouped. */
const TOP_REASONS = 5;

const stageIndex = (stage: LeadStage | null) => (stage ? LEAD_STAGES.indexOf(stage) : -1);
const sumMonthly = (leads: readonly LeadSummary[]) => leads.reduce((total, l) => total + (l.monthly ?? 0), 0);
const rate = (part: number, whole: number) => (whole ? part / whole : 0);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const byValue = (a: Row, b: Row) => b.value - a.value || a.label.localeCompare(b.label);

function countBy(leads: readonly LeadSummary[], key: (l: LeadSummary) => string | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const lead of leads) {
    const k = key(lead);
    if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

/**
 * Metrics for the last `days` days up to `now`, with the same-length period before it for comparison.
 * Leads that never finished the profile (no stage) are left out, as in the admin lead list.
 */
export function adminMetrics(all: readonly LeadSummary[], now: Date, days: Period): AdminMetrics {
  const leads = all.filter((l) => l.stage !== null);
  const end = now.getTime();
  const start = end - days * DAY;
  const previousStart = start - days * DAY;
  const inCurrent = (d: Date | null | undefined) => !!d && d.getTime() > start && d.getTime() <= end;
  const inPrevious = (d: Date | null | undefined) => !!d && d.getTime() > previousStart && d.getTime() <= start;

  const compare = (pick: (inWindow: typeof inCurrent) => number): Compared => ({ current: pick(inCurrent), previous: pick(inPrevious) });
  const created = (inWindow: typeof inCurrent) => leads.filter((l) => inWindow(l.createdAt));
  const activated = (inWindow: typeof inCurrent) => leads.filter((l) => inWindow(l.reached.Activated));

  const cohort = created(inCurrent);
  const funnel = LEAD_STAGES.map((stage, i) => ({ stage, count: cohort.filter((l) => stageIndex(l.stage) >= i).length }));

  const accepted = leads.filter((l) => inCurrent(l.reached["Quote accepted"]) && l.bundle);
  const bundles = [...countBy(accepted, (l) => l.bundle)].map(([tier, value]) => {
    const group = accepted.filter((l) => l.bundle === tier);
    return { label: TIER_LABELS[tier as keyof typeof TIER_LABELS], value, detail: `${pct(rate(value, accepted.length))} of quotes · avg ₹${Math.round(sumMonthly(group) / value).toLocaleString("en-IN")} a month` };
  });

  const segments = [...countBy(cohort, (l) => l.segment)].map(([label, value]) => {
    const won = cohort.filter((l) => l.segment === label && l.reached.Activated).length;
    return { label, value, detail: `${won} activated · ${pct(rate(won, value))}` };
  });

  const checked = leads.filter((l) => l.kyc && inCurrent(l.kyc.at));
  const kyc = [...countBy(checked, (l) => l.kyc!.decision)].map(([decision, value]) => ({
    label: KYC_LABELS[decision as KycDecision],
    value,
    detail: pct(rate(value, checked.length)),
  }));

  const closed = leads.filter((l) => l.status === "closed" && inCurrent(l.closedAt));
  const reasons = [...countBy(closed, (l) => l.closeReason?.trim() || "No reason given")].map(([label, value]) => ({ label, value })).sort(byValue);
  const otherReasons = reasons.slice(TOP_REASONS).reduce((total, r) => total + r.value, 0);
  const closedReasons = otherReasons ? [...reasons.slice(0, TOP_REASONS), { label: "Other reasons", value: otherReasons }] : reasons;
  const closedStages = LEAD_STAGES.map((stage) => ({ label: `At ${stage}`, value: closed.filter((l) => l.stage === stage).length })).filter((r) => r.value > 0);

  const pipelineLeads = leads.filter((l) => l.status === "open" && l.monthly !== null && (l.stage === "Quote accepted" || l.stage === "KYC complete"));

  return {
    days,
    newLeads: compare((w) => created(w).length),
    activations: compare((w) => activated(w).length),
    kpis: buildKpis(leads, inCurrent, inPrevious),
    revenueWon: compare((w) => sumMonthly(activated(w))),
    averageWon: compare((w) => {
      const group = activated(w);
      return group.length ? Math.round(sumMonthly(group) / group.length) : 0;
    }),
    pipeline: { leads: pipelineLeads.length, monthly: sumMonthly(pipelineLeads) },
    funnel: funnel.map((step, i) => ({ ...step, fromPrevious: i === 0 ? null : rate(step.count, funnel[i - 1]!.count) })),
    bundles: bundles.sort((a, b) => Object.values(TIER_LABELS).indexOf(a.label) - Object.values(TIER_LABELS).indexOf(b.label)),
    segments: segments.sort(byValue),
    kyc: kyc.sort((a, b) => Object.values(KYC_LABELS).indexOf(a.label) - Object.values(KYC_LABELS).indexOf(b.label)),
    closedReasons,
    closedStages,
    closedTotal: closed.length,
  };
}

/** The ?days= value, or 30. */
export function parsePeriod(value: string | string[] | undefined): Period {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (PERIODS as readonly number[]).includes(n) ? (n as Period) : 30;
}
