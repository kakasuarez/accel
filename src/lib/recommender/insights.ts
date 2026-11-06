import { eligibilityBlock } from "./eligibility";
import { FUNNEL_STAGES } from "./leads";
import type { BusinessProfile, Catalogue, Lead, Product, ProductId, Segment, Support } from "./types";

/** An add-on nearly everyone in a segment buys belongs in that segment's base bundle. */
const CORE_TAKE_UP = 0.9;
const CORE_MIN_LEADS = 10;
/** Used for a new product until there are sales to learn from. */
const DEFAULT_SEATS = 5;
const PEOPLE_UNITS = ["per line", "per user", "per device"];
const SITE_UNITS = ["per site", "per counter", "per camera"];

/** Customers arriving from these churn far more. Values from `current_internet` in the leads. */
export const FIRST_BUSINESS_LINK = ["None", "Mobile hotspot", "Home broadband"];

export type QuantityRule =
  | { kind: "fixed"; n: number }
  | { kind: "perSite"; n: number }
  | { kind: "upToStaff"; n: number };

export interface Insights {
  /** Bought rates among activated leads who were allowed to buy the product. */
  support(segment: Segment, id: ProductId): Support | null;
  isCore(segment: Segment, id: ProductId): boolean;
  /** How many add-ons to mark as recommended: the median real bundle. */
  recommendedCount(segment: Segment): number;
  quantity(segment: Segment, product: Product, profile: BusinessProfile): number;
  cityTierOf(city: string): number | undefined;
  segmentLabel(segment: Segment): string;
  /** 6-month churn among micro and professional customers. */
  retention: { firstBusinessLink: Support; existingBusinessLink: Support };
  /** Share activated, of leads reaching needs assessment. */
  gstin: { without: Support; with: Support; withoutButHasUdyam: Support };
  /** Share activated, of KYC-complete leads outside manufacturing. */
  fibreDelivery: { tier1: Support; tier2: Support };
}

const share = <T>(group: readonly T[], hit: (item: T) => boolean): Support => ({ taken: group.filter(hit).length, of: group.length });

export const rate = (support: Support) => (support.of === 0 ? 0 : support.taken / support.of);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Tries each way of sizing a product and keeps the one that best fits past sales, preferring the simpler. */
function fitQuantity(samples: { quantity: number; employees: number; sites: number }[]): QuantityRule {
  const typical = median(samples.map((s) => s.quantity));
  const candidates: QuantityRule[] = [
    { kind: "fixed", n: typical },
    { kind: "perSite", n: Math.max(1, Math.round(median(samples.map((s) => s.quantity / s.sites)))) },
    ...[...new Set(samples.map((s) => s.quantity))].map((n): QuantityRule => ({ kind: "upToStaff", n })),
  ];
  const error = (rule: QuantityRule) =>
    samples.reduce((sum, s) => sum + Math.abs(s.quantity - applyRule(rule, s.employees, s.sites)), 0);
  return candidates.reduce((best, rule) => (error(rule) < error(best) ? rule : best));
}

function applyRule(rule: QuantityRule, employees: number, sites: number): number {
  if (rule.kind === "perSite") return rule.n * sites;
  return rule.kind === "upToStaff" ? Math.min(rule.n, employees) : rule.n;
}

export function buildInsights(catalogue: Catalogue, leads: readonly Lead[]): Insights {
  const won = leads.filter((l) => l.activated);
  const segments = [...new Set(leads.map((l) => l.segment))];
  const supportBy = new Map<string, Support>();
  const quantityBy = new Map<string, QuantityRule>();
  const core = new Set<string>();
  const counts = new Map<Segment, number>();
  const key = (segment: Segment, id: ProductId) => `${segment}|${id}`;

  for (const segment of segments) {
    const group = won.filter((l) => l.segment === segment);
    for (const product of catalogue.products) {
      const eligible = group.filter((l) => !eligibilityBlock(product, l.profile, segment));
      const buyers = eligible.filter((l) => l.bundle.has(product.id));
      if (buyers.length === 0) continue;
      const support = { taken: buyers.length, of: eligible.length };
      supportBy.set(key(segment, product.id), support);
      quantityBy.set(
        key(segment, product.id),
        fitQuantity(buyers.map((l) => ({ quantity: l.bundle.get(product.id)!, employees: l.profile.employees, sites: l.profile.sites }))),
      );
      if (product.role === "add_on" && eligible.length >= CORE_MIN_LEADS && rate(support) >= CORE_TAKE_UP) {
        core.add(key(segment, product.id));
      }
    }
    const addOnCounts = group.map(
      (l) => [...l.bundle.keys()].filter((id) => catalogue.byId.get(id)?.role === "add_on" && !core.has(key(segment, id))).length,
    );
    counts.set(segment, median(addOnCounts));
  }

  const cityTiers = new Map(leads.map((l) => [l.city.trim().toLowerCase(), l.profile.cityTier]));
  const labels = new Map(leads.map((l) => [l.segment, l.segmentLabel]));
  const stage = (name: string) => FUNNEL_STAGES.indexOf(name);
  const activated = (l: Lead) => l.activated;
  const churned = (l: Lead) => l.churned;
  const retentionGroup = won.filter((l) => l.segment === "micro" || l.segment === "prof");
  const isFirstLink = (l: Lead) => FIRST_BUSINESS_LINK.includes(l.profile.currentInternet ?? "");
  const assessed = leads.filter((l) => l.stage >= stage("Needs assessed"));
  const fibreKyc = leads.filter((l) => l.stage >= stage("KYC complete") && l.segment !== "mfg");

  return {
    support: (segment, id) => supportBy.get(key(segment, id)) ?? null,
    isCore: (segment, id) => core.has(key(segment, id)),
    recommendedCount: (segment) => counts.get(segment) ?? 0,
    quantity(segment, product, profile) {
      const rule = quantityBy.get(key(segment, product.id));
      const people = PEOPLE_UNITS.includes(product.unit);
      if (rule) {
        const quantity = Math.max(1, applyRule(rule, profile.employees, profile.sites));
        return people ? Math.min(quantity, profile.employees) : quantity;
      }
      if (people) return Math.min(DEFAULT_SEATS, profile.employees);
      return SITE_UNITS.includes(product.unit) ? profile.sites : 1;
    },
    cityTierOf: (city) => cityTiers.get(city.trim().toLowerCase()),
    segmentLabel: (segment) => labels.get(segment) ?? segment,
    retention: {
      firstBusinessLink: share(retentionGroup.filter(isFirstLink), churned),
      existingBusinessLink: share(retentionGroup.filter((l) => !isFirstLink(l)), churned),
    },
    gstin: {
      without: share(assessed.filter((l) => !l.profile.hasGstin), activated),
      with: share(assessed.filter((l) => l.profile.hasGstin), activated),
      withoutButHasUdyam: share(assessed.filter((l) => !l.profile.hasGstin && l.hasUdyam), activated),
    },
    fibreDelivery: {
      tier1: share(fibreKyc.filter((l) => l.profile.cityTier === 1), activated),
      tier2: share(fibreKyc.filter((l) => l.profile.cityTier === 2), activated),
    },
  };
}
