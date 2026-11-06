import type { BusinessProfile, Lead, Segment } from "../types";

export interface FeatureSpace {
  encode(profile: BusinessProfile, segment: Segment): number[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Categories come from the training data; a value it never saw simply encodes as all zeros. */
export function buildFeatureSpace(leads: readonly Lead[]): FeatureSpace {
  const distinct = (pick: (lead: Lead) => string) => [...new Set(leads.map(pick))].sort();
  const segments = distinct((l) => l.segment);
  const internet = distinct((l) => l.profile.currentInternet ?? "");
  const types = distinct((l) => l.profile.businessType);

  // Spend is optional in a conversation, so stand in the segment's typical value.
  const typicalSpend = new Map(
    segments.map((segment) => [
      segment,
      median(leads.filter((l) => l.segment === segment).map((l) => l.profile.monthlyTelecomSpend ?? 0)),
    ]),
  );

  return {
    encode(profile, segment) {
      const spend = profile.monthlyTelecomSpend ?? typicalSpend.get(segment) ?? 0;
      return [
        profile.employees,
        profile.sites,
        profile.cityTier,
        profile.hasGstin ? 1 : 0,
        spend,
        spend / profile.employees,
        profile.employees / profile.sites,
        ...segments.map((s) => (s === segment ? 1 : 0)),
        ...internet.map((i) => (i === profile.currentInternet ? 1 : 0)),
        ...types.map((t) => (t === profile.businessType ? 1 : 0)),
      ];
    },
  };
}
