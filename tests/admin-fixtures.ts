import type { LeadSummary } from "../src/lib/admin/metrics";

export const NOW = new Date("2026-11-08T12:00:00Z");
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

export const lead = (over: Partial<LeadSummary>): LeadSummary => ({
  id: Math.random().toString(36),
  createdAt: daysAgo(1),
  stage: "Needs assessed",
  status: "open",
  closeReason: null,
  closedAt: null,
  segment: "Micro retail & services",
  bundle: null,
  monthly: null,
  reached: { "Needs assessed": daysAgo(1) },
  kyc: null,
  firstKyc: null,
  lastActivityAt: daysAgo(1),
  profile: { businessType: "Bakery", city: "Pune", hasGstin: true, currentInternet: "Mobile hotspot" },
  contact: { business: null, name: null, phone: null, email: "owner@example.com" },
  ...over,
});
