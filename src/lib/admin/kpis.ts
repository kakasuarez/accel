import type { LeadSummary } from "./metrics";

/**
 * The five numbers the digital journey is judged on:
 *
 *   quotedToActivated  of the businesses shown a quote (needs assessed), how many end up activated
 *   timeToActivate     days from lead to activation
 *   costPerActivation  what it costs to win one activated customer
 *   kycFirstPass       KYC "collected physically or over email": every failed check is a staff follow-up
 *   churn6Months       activated customers lost within 6 months
 *
 * Baselines are the case's figures for the old sales-led process: 17.6 days from lead to activation and
 * ₹15,050 to win a customer. Quoted to activated and churn come from training_leads.csv (5,000 leads). KYC was
 * paper, so it has no first-pass baseline. Targets are the month-12 targets in the submission deck (slide 2).
 *
 * The measured cost per activation is placeholder data: the app doesn't record acquisition spend, so it assumes
 * a fixed spend per business quoted (SPEND_PER_QUOTE). Replace it once real spend is recorded.
 *
 * 6-month churn isn't measured: there isn't enough history after activation yet.
 */
export const KPI_DEFINITIONS = {
  quotedToActivated: { label: "Quoted to activated", unit: "percent", better: "higher", target: 0.3, baseline: 0.186 },
  timeToActivate: { label: "Time to activation", unit: "days", better: "lower", target: 7, baseline: 17.6 },
  costPerActivation: { label: "Cost per activation", unit: "rupees", better: "lower", target: 4850, baseline: 15050 },
  kycFirstPass: { label: "KYC approved first time", unit: "percent", better: "higher", target: 0.8, baseline: null },
  churn6Months: { label: "6-month churn", unit: "percent", better: "lower", target: 0.1, baseline: 0.152 },
} as const satisfies Record<string, KpiDefinition>;

export interface KpiDefinition {
  label: string;
  unit: "percent" | "days" | "rupees";
  better: "higher" | "lower";
  /** Null when there's nothing to set one against yet. */
  target: number | null;
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
/** Placeholder: assumed acquisition spend in rupees for each business quoted. */
const SPEND_PER_QUOTE = 600;

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
  const quoted = () => leads.filter((l) => inWindow(l.reached["Needs assessed"] ?? l.createdAt)).length;
  const activations = () => leads.filter((l) => inWindow(l.reached.Activated)).length;
  switch (id) {
    case "quotedToActivated":
      return flow(activations(), quoted());
    case "timeToActivate": {
      // From the lead's start, like the case's 17.6 days.
      const days = leads.filter((l) => inWindow(l.reached.Activated)).map((l) => (l.reached.Activated!.getTime() - l.createdAt.getTime()) / DAY);
      return { value: median(days), sample: days.length };
    }
    case "costPerActivation": {
      const won = activations();
      return { value: won ? (quoted() * SPEND_PER_QUOTE) / won : null, sample: won };
    }
    case "kycFirstPass": {
      const checked = leads.filter((l) => l.firstKyc && inWindow(l.firstKyc.at));
      const passed = checked.filter((l) => l.firstKyc!.decision === "APPROVE").length;
      return { value: checked.length ? passed / checked.length : null, sample: checked.length };
    }
    case "churn6Months":
      return { value: null, sample: 0 };
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const BASIS: Record<KpiId, (n: number) => string> = {
  quotedToActivated: (n) => `Activations ÷ ${plural(n, "business", "businesses")} quoted`,
  timeToActivate: (n) => `Median from first contact, ${plural(n, "activation", "activations")}`,
  costPerActivation: (n) => `Acquisition spend ÷ ${plural(n, "activation", "activations")}`,
  kycFirstPass: (n) => `Of ${plural(n, "business", "businesses")} checked for the first time`,
  churn6Months: () => "Not enough data yet: needs six months of customers after activation",
};

export function buildKpis(leads: readonly LeadSummary[], current: Window, previous: Window): Kpi[] {
  return (Object.keys(KPI_DEFINITIONS) as KpiId[]).map((id) => {
    const definition: KpiDefinition = KPI_DEFINITIONS[id];
    const value = measure(id, leads, current);
    const { target } = definition;
    const onTarget = value.value === null || target === null ? null : definition.better === "higher" ? value.value >= target : value.value <= target;
    return { id, ...definition, current: value, previous: measure(id, leads, previous), basis: BASIS[id](value.sample), onTarget };
  });
}
