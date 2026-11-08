import type { LeadSummary } from "./metrics";

/**
 * The four numbers the digital journey is judged on. Each answers one of the old journey's problems:
 *
 *   conversion        "a large share of interested prospects drop out before activation"
 *   timeToActivate    quote in 3–5 days, then installation and activation in 10–14
 *   quoteToActivation customers who said yes but were lost to paper KYC and slow installation
 *   kycFirstPass      KYC "collected physically or over email": every failed check is a staff follow-up
 *
 * Baselines come from training_leads.csv (the old sales-led process, 5,000 leads), except time to
 * activate, which those leads don't record: it's the brief's 3–5 days to quote plus 10–14 to activate,
 * about 16 days at the midpoint. KYC was paper, so it has no first-pass baseline.
 *
 * Cost of acquisition and 6-month churn aren't here: the app records neither costs nor what happens
 * after activation yet.
 */
export const KPI_DEFINITIONS = {
  conversion: { label: "Lead to activation", unit: "percent", better: "higher", target: 0.3, baseline: 0.186 },
  timeToActivate: { label: "Time to activate", unit: "days", better: "lower", target: 7, baseline: 16 },
  quoteToActivation: { label: "Accepted quotes activated", unit: "percent", better: "higher", target: 0.75, baseline: 0.427 },
  kycFirstPass: { label: "KYC approved first time", unit: "percent", better: "higher", target: 0.8, baseline: null },
} as const satisfies Record<string, KpiDefinition>;

export interface KpiDefinition {
  label: string;
  unit: "percent" | "days";
  better: "higher" | "lower";
  target: number;
  baseline: number | null;
}

export type KpiId = keyof typeof KPI_DEFINITIONS;

export interface KpiValue {
  /** Null when nothing in the period can be measured yet. */
  value: number | null;
  /** How many leads the value is based on. */
  sample: number;
}

export interface Kpi extends KpiDefinition {
  id: KpiId;
  current: KpiValue;
  previous: KpiValue;
  /** What the number is measured over, for the tile's note. */
  basis: string;
  /** Null when there's no value to judge. */
  onTarget: boolean | null;
}

const DAY = 24 * 60 * 60 * 1000;

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

type Window = (d: Date | null | undefined) => boolean;

/**
 * Conversion rates are flows: activations in the period over leads (or accepted quotes) in the period.
 * Following one period's leads to their outcome instead would make every recent period look better
 * or worse than it is, because wins (about 9 days) and losses (weeks, or never closed) settle at
 * different speeds. A flow works for any period; while volume grows it reads slightly low.
 */
function flow(activations: number, entries: number): KpiValue {
  return { value: entries ? Math.min(1, activations / entries) : null, sample: entries };
}

function measure(id: KpiId, leads: readonly LeadSummary[], inWindow: Window): KpiValue {
  const activations = () => leads.filter((l) => inWindow(l.reached.Activated)).length;
  switch (id) {
    case "conversion":
      return flow(activations(), leads.filter((l) => inWindow(l.reached["Needs assessed"] ?? l.createdAt)).length);
    case "quoteToActivation":
      return flow(activations(), leads.filter((l) => inWindow(l.reached["Quote accepted"])).length);
    case "timeToActivate": {
      const days = leads
        .filter((l) => inWindow(l.reached.Activated) && l.reached["Needs assessed"])
        .map((l) => (l.reached.Activated!.getTime() - l.reached["Needs assessed"]!.getTime()) / DAY);
      return { value: median(days), sample: days.length };
    }
    case "kycFirstPass": {
      const checked = leads.filter((l) => l.firstKyc && inWindow(l.firstKyc.at));
      const passed = checked.filter((l) => l.firstKyc!.decision === "APPROVE").length;
      return { value: checked.length ? passed / checked.length : null, sample: checked.length };
    }
  }
}

const BASIS: Record<KpiId, (n: number) => string> = {
  conversion: (n) => `Activations ÷ ${n} new ${n === 1 ? "lead" : "leads"}`,
  quoteToActivation: (n) => `Activations ÷ ${n} accepted ${n === 1 ? "quote" : "quotes"}`,
  timeToActivate: (n) => `Median from needs assessed, ${n} ${n === 1 ? "activation" : "activations"}`,
  kycFirstPass: (n) => `Of ${n} ${n === 1 ? "business" : "businesses"} checked for the first time`,
};

export function buildKpis(leads: readonly LeadSummary[], current: Window, previous: Window): Kpi[] {
  return (Object.keys(KPI_DEFINITIONS) as KpiId[]).map((id) => {
    const definition: KpiDefinition = KPI_DEFINITIONS[id];
    const value = measure(id, leads, current);
    const onTarget = value.value === null ? null : definition.better === "higher" ? value.value >= definition.target : value.value <= definition.target;
    return { id, ...definition, current: value, previous: measure(id, leads, previous), basis: BASIS[id](value.sample), onTarget };
  });
}
