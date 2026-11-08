import { describe, expect, it } from "vitest";
import { adminMetrics, parsePeriod, type LeadSummary } from "../src/lib/admin/metrics";

const NOW = new Date("2026-11-08T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const lead = (over: Partial<LeadSummary>): LeadSummary => ({
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
  ...over,
});

const activated = (createdDaysAgo: number, monthly: number) =>
  lead({
    createdAt: daysAgo(createdDaysAgo),
    stage: "Activated",
    bundle: "budget",
    monthly,
    reached: { "Needs assessed": daysAgo(createdDaysAgo), "Quote accepted": daysAgo(createdDaysAgo - 0.5), "KYC complete": daysAgo(createdDaysAgo - 1), Activated: daysAgo(createdDaysAgo - 2) },
    kyc: { decision: "APPROVE", at: daysAgo(createdDaysAgo - 1) },
    firstKyc: { decision: "APPROVE", at: daysAgo(createdDaysAgo - 1) },
  });

describe("admin metrics", () => {
  const leads = [
    lead({}),
    lead({ createdAt: daysAgo(3), status: "closed", closeReason: "Price too high", closedAt: daysAgo(2) }),
    lead({ stage: "Quote accepted", bundle: "recommended", monthly: 5000, reached: { "Needs assessed": daysAgo(1), "Quote accepted": daysAgo(0.5) } }),
    activated(5, 2000),
    activated(12, 3000), // previous 7-day period
    lead({ createdAt: daysAgo(2), stage: null }), // never finished the profile: left out
  ];
  const m = adminMetrics(leads, NOW, 7);

  it("compares this period with the one before", () => {
    expect(m.newLeads).toEqual({ current: 4, previous: 1 });
    expect(m.activations).toEqual({ current: 1, previous: 1 });
    expect(m.revenueWon).toEqual({ current: 2000, previous: 3000 });
  });

  it("counts the funnel by furthest stage reached", () => {
    expect(m.funnel.map((s) => s.count)).toEqual([4, 2, 1, 1]);
    expect(m.funnel[1]!.fromPrevious).toBe(0.5);
  });

  it("puts accepted but not activated quotes in the pipeline", () => {
    expect(m.pipeline).toEqual({ leads: 1, monthly: 5000 });
  });

  it("splits bundles, KYC, segments and closed leads", () => {
    expect(m.bundles.map((b) => [b.label, b.value])).toEqual([["Recommended", 1], ["Budget", 1]]);
    expect(m.kyc.map((k) => [k.label, k.value])).toEqual([["Approved", 1]]);
    expect(m.segments[0]).toMatchObject({ label: "Micro retail & services", value: 4, detail: "1 activated · 25%" });
    expect(m.closedReasons).toEqual([{ label: "Price too high", value: 1 }]);
    expect(m.closedStages).toEqual([{ label: "At Needs assessed", value: 1 }]);
  });

  it("measures the KPIs against their targets", () => {
    const kpi = (id: string) => m.kpis.find((k) => k.id === id)!;
    // 1 activation in the period over 4 new leads; 1 over 2 accepted quotes (the 5-day-old lead's and today's).
    expect(kpi("conversion").current).toEqual({ value: 0.25, sample: 4 });
    expect(kpi("conversion").onTarget).toBe(false);
    expect(kpi("quoteToActivation").current).toEqual({ value: 0.5, sample: 2 });
    // Activated 2 days after needs were assessed.
    expect(kpi("timeToActivate").current).toEqual({ value: 2, sample: 1 });
    expect(kpi("timeToActivate").onTarget).toBe(true);
    expect(kpi("kycFirstPass").current).toEqual({ value: 1, sample: 1 });
  });

  it("judges KYC on the first attempt, not the latest", () => {
    const retried = lead({ stage: "KYC complete", firstKyc: { decision: "REJECT", at: daysAgo(3) }, kyc: { decision: "APPROVE", at: daysAgo(2) } });
    const kpis = adminMetrics([retried, activated(5, 1000)], NOW, 7).kpis;
    expect(kpis.find((k) => k.id === "kycFirstPass")!.current).toEqual({ value: 0.5, sample: 2 });
  });

  it("has no value, and no verdict, when there's nothing to measure", () => {
    const empty = adminMetrics([], NOW, 7).kpis;
    expect(empty.every((k) => k.current.value === null && k.onTarget === null)).toBe(true);
  });

  it("reads the period from the URL, defaulting to 30 days", () => {
    expect([parsePeriod("7"), parsePeriod("90"), parsePeriod("5"), parsePeriod(undefined)]).toEqual([7, 90, 30, 30]);
  });
});
