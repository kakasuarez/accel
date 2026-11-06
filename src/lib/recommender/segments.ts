import type { Lead, Segment } from "./types";

const FACTORY_WORDS = /\b(unit|factory|workshop|press|plant|mill|manufactur\w*|fabricat\w*|foundry)\b/;
const OFFICE_WORDS = /\b(office|firm|agency|studio|clinic|lab|consult\w*|advisor\w*|academy|centre|center|school)\b/;

export interface SegmentResult {
  segment: Segment;
  /** True when the segment came from a heuristic rather than a known business type at a typical size. */
  inferred: boolean;
}

export interface SegmentIndex {
  businessTypes: readonly string[];
  classify(businessType: string, employees: number, sites: number): SegmentResult;
}

/** The type-to-segment table and size limits are read off the leads, so new types need no code change. */
export function buildSegmentIndex(leads: readonly Lead[]): SegmentIndex {
  const byType = new Map<string, Segment>();
  const types = new Set<string>();
  let microMaxEmployees = 0;
  let multiSiteFrom = Infinity;
  for (const lead of leads) {
    types.add(lead.profile.businessType);
    byType.set(lead.profile.businessType.toLowerCase(), lead.segment);
    if (lead.segment === "micro") microMaxEmployees = Math.max(microMaxEmployees, lead.profile.employees);
    if (lead.segment === "multi") multiSiteFrom = Math.min(multiSiteFrom, lead.profile.sites);
  }

  return {
    businessTypes: [...types].sort(),
    classify(businessType, employees, sites) {
      const type = businessType.trim().toLowerCase();
      const known = byType.get(type);
      // Unlike the raw type, an actual chain of salons needs multi-site products.
      if (sites >= multiSiteFrom && known !== "mfg" && !FACTORY_WORDS.test(type)) {
        return { segment: "multi", inferred: known !== "multi" };
      }
      if (known) return { segment: known, inferred: false };
      if (FACTORY_WORDS.test(type)) return { segment: "mfg", inferred: true };
      if (OFFICE_WORDS.test(type)) return { segment: "prof", inferred: true };
      return { segment: employees <= microMaxEmployees ? "micro" : "prof", inferred: true };
    },
  };
}
