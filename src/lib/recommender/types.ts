/** Ids and segment codes come from the CSVs, so they're plain strings: nothing here names a product. */
export type ProductId = string;
export type Segment = string;

export type ProductRole = "link" | "mobile" | "add_on";

export interface Product {
  id: ProductId;
  category: string;
  name: string;
  description: string;
  unit: string;
  priceMin: number;
  priceMax: number;
  setupFee: number;
  minContractMonths: number;
  cityTiers: readonly number[];
  minEmployees: number;
  minSites: number;
  requiresGstin: boolean;
  requiresOneOf: readonly ProductId[];
  installDays: number;
  targetSegments: readonly Segment[];
  /** Plain-language question about the need this product meets. Null means none was written. */
  customerQuestion: string | null;
  /** Derived from the columns above. */
  role: ProductRole;
  needsFibre: boolean;
  speedMbps: number | null;
}

export interface Catalogue {
  products: readonly Product[];
  byId: ReadonlyMap<ProductId, Product>;
}

export interface BusinessProfile {
  /** Ideally one of `businessTypes`; free text falls back to inference. */
  businessType: string;
  employees: number;
  sites: number;
  /** Use the highest tier number if sites span tiers: availability is limited by the worst site. */
  cityTier: number;
  hasGstin: boolean;
  /** One of the values in the leads, e.g. "Business broadband". */
  currentInternet?: string;
  /** Current total monthly telecom spend in INR. */
  monthlyTelecomSpend?: number;
  /** Undefined means nobody has checked serviceability yet. */
  fibreAvailable?: boolean;
  /** Large file transfers, video work, or cloud-dependent operations. */
  heavyBandwidth?: boolean;
  /** By product id. true = wants it; false = doesn't, or already has a tool for it. */
  needs?: Readonly<Record<ProductId, boolean>>;
}

export interface Lead {
  id: string;
  created: string;
  city: string;
  segment: Segment;
  segmentLabel: string;
  activated: boolean;
  /** Index into FUNNEL_STAGES: the furthest stage this lead reached. */
  stage: number;
  hasUdyam: boolean;
  /** Empty for dropped leads. */
  bundle: ReadonlyMap<ProductId, number>;
  monthlyValue: number;
  churned: boolean;
  profile: BusinessProfile;
}

/** `taken` of the `of` leads who could buy it did. */
export interface Support {
  taken: number;
  of: number;
}

export type LineRole = "link" | "mobile" | "core";

interface Priced {
  productId: ProductId;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  /** Plain-language reason. A GenAI layer may reword this but must not add claims. */
  why: string;
  /** Null when this segment has no sales history for the product. */
  support: Support | null;
  /** The model's estimate that this customer would buy it, 0 to 1. Useful for ranking, not a guarantee. */
  score: number;
  monthlyMin: number;
  monthlyMax: number;
  setupFee: number;
  minContractMonths: number;
  installDays: number;
}

/** Part of the base bundle. Add-ons are never lines: the customer picks them from `addOns`. */
export interface BundleLine extends Priced {
  role: LineRole;
}

/**
 * stated_need: the customer said they want it.
 * model: the model ranks it highly and the customer hasn't said either way.
 */
export type AddOnRecommendation = "stated_need" | "model";

/** One row of the add-on picker. Nothing is selected for the customer. */
export interface AddOnOption extends Priced {
  /** Null means the product is available but we aren't recommending it. */
  recommendation: AddOnRecommendation | null;
}

export interface BundleTotals {
  monthlyMin: number;
  monthlyMax: number;
  setupFee: number;
  /** Longest minimum contract among the items. */
  contractMonths: number;
  /** Slowest install among the items; others may go live sooner. */
  installDays: number;
}

export type BlockCode = "segment" | "city_tier" | "min_employees" | "min_sites" | "gstin" | "dependency" | "no_fibre";

export interface BlockedProduct {
  productId: ProductId;
  name: string;
  code: BlockCode;
  reason: string;
}

export interface AlternativeLink {
  productId: ProductId;
  name: string;
  /** Change in the bundle's minimum monthly price if swapped in. */
  monthlyMinDelta: number;
  support: Support | null;
}

export type FlagCode =
  | "segment_inferred"
  | "no_eligible_link"
  | "city_unconfirmed"
  | "gstin_unconfirmed"
  | "fibre_unconfirmed"
  | "second_site_not_covered"
  | "retention_risk_first_business_link"
  | "kyc_risk_no_gstin"
  | "tier2_fibre_delivery_risk"
  | "long_install";

export interface Flag {
  code: FlagCode;
  /** "internal" flags are for sales staff and must never be shown to a prospect. */
  audience: "customer" | "internal";
  message: string;
}

export interface OpenQuestion {
  /** "fibreAvailable", "heavyBandwidth", or a product id for `needs`. */
  key: string;
  question: string;
}

export interface Recommendation {
  segment: Segment;
  segmentLabel: string;
  /** The base bundle. Empty of a link if `no_eligible_link` is flagged. */
  lines: BundleLine[];
  /** Base bundle only. Use `priceWithAddOns` once the customer has picked. */
  totals: BundleTotals;
  alternatives: AlternativeLink[];
  /** Every add-on this customer can buy: recommended first, best match first. */
  addOns: AddOnOption[];
  /** Products the customer wanted, or would have suited them, that they can't have. */
  blocked: BlockedProduct[];
  flags: Flag[];
  /** Questions that could still change the result, most consequential first. */
  openQuestions: OpenQuestion[];
}
