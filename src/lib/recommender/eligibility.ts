import { message } from "./messages";
import type { BlockCode, BusinessProfile, Product, ProductId, Segment } from "./types";

export interface Block {
  code: BlockCode;
  reason: string;
  params: Readonly<Record<string, string | number>>;
}

function block(code: BlockCode, params: Readonly<Record<string, string | number>>): Block {
  return { code, reason: message(`block.${code}`, params), params };
}

/**
 * The catalogue is the source of truth, including `target_segments`, even where past
 * sales broke it. Returns the first failed rule, or null if the customer can buy it.
 * Leave out `selected` to skip the dependency check.
 */
export function eligibilityBlock(
  product: Product,
  profile: BusinessProfile,
  segment: Segment,
  selected?: ReadonlySet<ProductId>,
): Block | null {
  if (!product.targetSegments.includes(segment)) {
    return block("segment", { product: product.name });
  }
  if (!product.cityTiers.includes(profile.cityTier)) {
    return block("city_tier", { product: product.name, tier: profile.cityTier });
  }
  if (product.needsFibre && profile.fibreAvailable === false) {
    return block("no_fibre", { product: product.name });
  }
  if (profile.employees < product.minEmployees) {
    return block("min_employees", { product: product.name, min: product.minEmployees });
  }
  if (profile.sites < product.minSites) {
    return block("min_sites", { product: product.name, min: product.minSites });
  }
  if (product.requiresGstin && !profile.hasGstin) {
    return block("gstin", { product: product.name });
  }
  if (selected && product.requiresOneOf.length > 0 && !product.requiresOneOf.some((id) => selected.has(id))) {
    return block("dependency", { product: product.name });
  }
  return null;
}
