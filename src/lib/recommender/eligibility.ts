import type { BlockCode, BusinessProfile, Product, ProductId, Segment } from "./types";

export interface Block {
  code: BlockCode;
  reason: string;
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
    return { code: "segment", reason: `${product.name} isn't offered to this type of business.` };
  }
  if (!product.cityTiers.includes(profile.cityTier)) {
    return { code: "city_tier", reason: `${product.name} isn't available in tier ${profile.cityTier} cities yet.` };
  }
  if (product.needsFibre && profile.fibreAvailable === false) {
    return { code: "no_fibre", reason: `${product.name} needs fibre, which isn't available at your location.` };
  }
  if (profile.employees < product.minEmployees) {
    return { code: "min_employees", reason: `${product.name} is for businesses with ${product.minEmployees}+ employees.` };
  }
  if (profile.sites < product.minSites) {
    return { code: "min_sites", reason: `${product.name} is for businesses with ${product.minSites}+ sites.` };
  }
  if (product.requiresGstin && !profile.hasGstin) {
    return { code: "gstin", reason: `${product.name} requires a GSTIN.` };
  }
  if (selected && product.requiresOneOf.length > 0 && !product.requiresOneOf.some((id) => selected.has(id))) {
    return { code: "dependency", reason: `${product.name} doesn't work with the internet connection in this bundle.` };
  }
  return null;
}
