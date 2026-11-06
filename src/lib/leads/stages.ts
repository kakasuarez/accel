export const LEAD_STAGES = ["Needs assessed", "Quote accepted", "KYC complete", "Activated"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** Reached when the customer finishes the matching step. */
export const STAGE_AFTER_PROFILE: LeadStage = "Needs assessed";
export const STAGE_AFTER_QUOTE: LeadStage = "Quote accepted";

/** Staff can only move a lead one step along, and only past the steps the customer completes. */
export function canAdvance(current: LeadStage | null, target: LeadStage): boolean {
  if (!current) return false;
  const from = LEAD_STAGES.indexOf(current);
  return from >= LEAD_STAGES.indexOf(STAGE_AFTER_QUOTE) && LEAD_STAGES.indexOf(target) === from + 1;
}
