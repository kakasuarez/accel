import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { callList, profileLift, scoreLead, STALL_DAYS, trainPropensity } from "../src/lib/admin/propensity";
import { parseLeads } from "../src/lib/recommender";
import { NOW, daysAgo, lead } from "./admin-fixtures";

const model = trainPropensity(parseLeads(readFileSync("training_leads.csv", "utf8")));
const stalled = (days: number, over: Parameters<typeof lead>[0] = {}) => lead({ createdAt: daysAgo(days), lastActivityAt: daysAgo(days), ...over });

describe("propensity to activate", () => {
  it("starts from the old process's activation rate at each stage", () => {
    expect(model.base["Needs assessed"]).toBeCloseTo(0.186, 2);
    expect(model.base["Quote accepted"]).toBeCloseTo(0.427, 2);
    expect(model.base["KYC complete"]).toBeCloseTo(0.626, 2);
  });

  it("learns that a GSTIN and a professional office help, and a micro shop on a hotspot doesn't", () => {
    expect(model.gstin.get(true)!).toBeGreaterThan(1);
    expect(model.gstin.get(false)!).toBeLessThan(1);
    expect(profileLift(model, { segment: "Professional offices", hasGstin: true, currentInternet: "Leased line" })).toBeGreaterThan(
      profileLift(model, { segment: "Micro retail & services", hasGstin: false, currentInternet: "Mobile hotspot" }),
    );
  });

  it("only scores open leads that have stalled", () => {
    expect(scoreLead(model, stalled(STALL_DAYS - 1), NOW)).toBeNull();
    expect(scoreLead(model, stalled(10, { status: "closed" }), NOW)).toBeNull();
    expect(scoreLead(model, stalled(10, { stage: "Activated" }), NOW)).toBeNull();
    expect(scoreLead(model, stalled(STALL_DAYS), NOW)).not.toBeNull();
  });

  it("scores further stages higher, and idle or rejected leads lower", () => {
    const at = (stage: "Needs assessed" | "KYC complete", days = 4) => scoreLead(model, stalled(days, { stage }), NOW)!.score;
    expect(at("KYC complete")).toBeGreaterThan(at("Needs assessed"));
    expect(at("Needs assessed", 40)).toBeLessThan(at("Needs assessed", 4));
    const rejected = scoreLead(model, stalled(4, { stage: "Quote accepted", kyc: { decision: "REJECT", at: daysAgo(4) } }), NOW)!;
    expect(rejected.score).toBeLessThan(scoreLead(model, stalled(4, { stage: "Quote accepted" }), NOW)!.score);
    expect(rejected.reasons).toContainEqual({ label: "KYC rejected", effect: "down" });
  });

  it("lists the stalled leads best first, with the value at stake", () => {
    const list = callList(
      model,
      [
        stalled(5, { id: "early" }),
        stalled(5, { id: "quoted", stage: "Quote accepted", monthly: 4000, contact: { business: "Rao Clinic", name: "Meera Rao", phone: "+91 900", email: null } }),
        stalled(1, { id: "fresh" }),
      ],
      NOW,
    );
    expect(list.total).toBe(2);
    expect(list.monthlyAtStake).toBe(4000);
    expect(list.top.map((l) => l.id)).toEqual(["quoted", "early"]);
    expect(list.top[0]).toMatchObject({ business: "Rao Clinic", phone: "+91 900", idleDays: 5 });
    expect(list.top[1]!.business).toBe("Bakery, Pune");
    expect(list.byStage.map((r) => r.value)).toEqual([1, 1, 0]);
  });
});
