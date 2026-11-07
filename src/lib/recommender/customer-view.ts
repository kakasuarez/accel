import type { AddOnOption, AlternativeLink, BundleLine, Recommendation } from "./types";

type Public<T> = Omit<T, "score" | "support">;

export interface CustomerRecommendation extends Omit<Recommendation, "lines" | "addOns" | "alternatives" | "mobileAlternatives"> {
  lines: Public<BundleLine>[];
  addOns: Public<AddOnOption>[];
  alternatives: Omit<AlternativeLink, "support">[];
  mobileAlternatives: Omit<AlternativeLink, "support">[];
}

const withoutStats = <T extends { score: number; support: unknown }>({ score: _score, support: _support, ...rest }: T) => rest;

/**
 * All a customer, or the LLM, may see. Removes internal flags, which quote churn and conversion
 * rates, and model scores. Fibre can't be checked by the customer, so it isn't asked.
 */
export function customerView(recommendation: Recommendation): CustomerRecommendation {
  return {
    ...recommendation,
    lines: recommendation.lines.map(withoutStats),
    addOns: recommendation.addOns.map(withoutStats),
    alternatives: recommendation.alternatives.map(({ support: _support, ...rest }) => rest),
    // Quotes accepted before mobile plans could be swapped were saved without this field.
    mobileAlternatives: (recommendation.mobileAlternatives ?? []).map(({ support: _support, ...rest }) => rest),
    flags: recommendation.flags.filter((flag) => flag.audience === "customer"),
    openQuestions: recommendation.openQuestions.filter((question) => question.key !== "fibreAvailable"),
  };
}
