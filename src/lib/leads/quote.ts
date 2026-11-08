import { addOnQuestionId } from "../questions/build";
import type { Answers, Question, QuestionSet } from "../questions/types";
import { ApiError } from "../http";
import { budgetMobileLines, isChoiceError, priceWithAddOns, quotedPrice, type BundleTotals, type BusinessProfile, type Catalogue, type Choices, type Flag, type ProductId, type Recommendation, type Recommender } from "../recommender";

/** The next question for this customer, or null once there's nothing left to ask. */
export function nextQuestion({ questions, maxAddOnQuestions }: QuestionSet, answers: Answers, recommendation: Recommendation | null): Question | null {
  const answered = (question: Question) => question.id in answers;
  const profileQuestion = questions.find((q) => q.phase === "profile" && !answered(q));
  if (profileQuestion) return profileQuestion;
  if (!recommendation) return null;

  const addOnQuestions = questions.filter((q) => q.phase === "add_ons");
  if (addOnQuestions.filter(answered).length >= maxAddOnQuestions) return null;
  for (const { key } of recommendation.openQuestions) {
    const question = addOnQuestions.find((q) => q.id === addOnQuestionId(key));
    if (question && !answered(question)) return question;
  }
  return null;
}

export const profileComplete = ({ questions }: QuestionSet, answers: Answers) => questions.filter((q) => q.phase === "profile").every((q) => q.id in answers);

/** Cities without a known tier are quoted on the most restricted tier any product is sold in. */
const strictestTier = (catalogue: Catalogue) => Math.max(...catalogue.products.flatMap((p) => p.cityTiers));

function toProfile(recommender: Recommender, { questions }: QuestionSet, answers: Answers): BusinessProfile {
  const needs: Record<string, boolean> = {};
  for (const question of questions) {
    if (question.phase !== "add_ons" || !question.productId) continue;
    const sets = question.options?.find((o) => o.value === answers[question.id])?.sets;
    if (typeof sets === "boolean") needs[question.productId] = sets;
  }
  const city = String(answers.city);
  return {
    businessType: String(answers.businessType),
    employees: Number(answers.employees),
    sites: Number(answers.sites),
    cityTier: recommender.cityTierOf(city) ?? strictestTier(recommender.catalogue),
    hasGstin: answers.hasGstin === true,
    // Either may be null when the customer wasn't sure. Not knowing about GST is treated as not registered.
    currentInternet: typeof answers.currentInternet === "string" ? answers.currentInternet : undefined,
    monthlyTelecomSpend: typeof answers.monthlyTelecomSpend === "number" ? answers.monthlyTelecomSpend : undefined,
    heavyBandwidth: typeof answers.heavyBandwidth === "boolean" ? answers.heavyBandwidth : undefined,
    needs,
  };
}

/** Recalculated from the stored answers each time, so it always reflects the live catalogue. */
export function recommendationFor(recommender: Recommender, questionSet: QuestionSet, answers: Answers, choices?: Choices): Recommendation | null {
  if (!profileComplete(questionSet, answers)) return null;
  let recommendation: Recommendation;
  try {
    recommendation = recommender.recommend(toProfile(recommender, questionSet, answers), choices);
  } catch (error) {
    if (isChoiceError(error)) throw new ApiError(400, "invalid_choice", error.message);
    throw error;
  }
  const city = String(answers.city);
  const flags: Flag[] = [];
  if (recommender.cityTierOf(city) === undefined) {
    flags.push({ code: "city_unconfirmed", audience: "customer", message: `Availability in ${city} is to be confirmed, so this quote may change.` });
  }
  if (answers.hasGstin === null) {
    flags.push({
      code: "gstin_unconfirmed",
      audience: "customer",
      message: "You weren't sure about GST registration, so we've left out products that need a GST number. You can confirm it when you upload your documents.",
    });
  }
  return flags.length ? { ...recommendation, flags: [...recommendation.flags, ...flags] } : recommendation;
}

export interface PricedSelection {
  totals: BundleTotals;
  /** The add-ons that were priced. */
  selectedAddOns: ProductId[];
  /** Ticked add-ons this bundle can no longer have, e.g. Static IP after switching to wireless internet. */
  removedAddOns: { productId: ProductId; name: string }[];
}

/** Prices the ticked add-ons, leaving out any the bundle no longer allows so the picker can untick them. */
export function priceSelection(recommendation: Recommendation, ticked: readonly ProductId[], catalogue: Catalogue): PricedSelection {
  const available = new Set(recommendation.addOns.map((a) => a.productId));
  const unique = [...new Set(ticked)];
  const selectedAddOns = unique.filter((id) => available.has(id));
  const removedAddOns = unique.filter((id) => !available.has(id)).map((id) => ({ productId: id, name: catalogue.byId.get(id)?.name ?? id }));
  return { totals: priceWithAddOns(recommendation, selectedAddOns), selectedAddOns, removedAddOns };
}

export const BUNDLE_TIERS = ["recommended", "budget", "premium"] as const;
export type BundleTier = (typeof BUNDLE_TIERS)[number];
const TIER_LABELS: Record<BundleTier, string> = { recommended: "Recommended", budget: "Budget", premium: "Premium" };

export interface BundleOption {
  tier: BundleTier;
  label: string;
  recommendation: Recommendation;
  /** How this bundle differs from Recommended, e.g. "Saves ₹399 a month: …". Null for Recommended. */
  comparison: string | null;
}

/**
 * Up to three bundles, Recommended first. Budget moves to the cheapest internet connection and mobile plan
 * this customer can have, and cuts mobile lines as far as the segment's price sensitivity allows. Premium moves
 * to the next dearer connection and plan. Each is rebuilt through the catalogue rules, and a bundle that comes
 * out the same as Recommended is left out.
 */
export function bundleOptions(recommender: Recommender, questionSet: QuestionSet, answers: Answers): BundleOption[] | null {
  const recommended = recommendationFor(recommender, questionSet, answers);
  if (!recommended) return null;
  const options: BundleOption[] = [{ tier: "recommended", label: TIER_LABELS.recommended, recommendation: recommended, comparison: null }];
  const add = (tier: BundleTier, choices: Choices) => {
    const recommendation = recommendationFor(recommender, questionSet, answers, choices)!;
    if (sameLines(recommendation, recommended)) return;
    options.push({ tier, label: TIER_LABELS[tier], recommendation, comparison: compare(recommendation, recommended) });
  };

  const link = recommended.lines.find((l) => l.role === "link");
  const mobile = recommended.lines.find((l) => l.role === "mobile");
  const sensitivity = recommender.priceSensitivity(recommended.segment);
  const price = (id: ProductId) => quotedPrice(recommender.catalogue.byId.get(id)!, sensitivity);
  const cheapest = (current: ProductId, others: readonly { productId: ProductId }[]) =>
    [current, ...others.map((o) => o.productId)].sort((a, b) => price(a) - price(b))[0]!;
  const nextUp = (current: ProductId, others: readonly { productId: ProductId }[]) =>
    others.map((o) => o.productId).filter((id) => price(id) > price(current)).sort((a, b) => price(a) - price(b))[0];

  const budget: Choices = {};
  if (link) budget.link = cheapest(link.productId, recommended.alternatives);
  if (mobile) {
    budget.mobile = cheapest(mobile.productId, recommended.mobileAlternatives);
    const lines = budgetMobileLines(sensitivity, mobile.quantity);
    if (lines < mobile.quantity) budget.quantities = { [budget.mobile]: lines };
  }
  add("budget", budget);

  const premium: Choices = {};
  if (link) premium.link = nextUp(link.productId, recommended.alternatives);
  if (mobile) premium.mobile = nextUp(mobile.productId, recommended.mobileAlternatives);
  if (premium.link || premium.mobile) add("premium", premium);
  return options;
}

const lineKey = (r: Recommendation) => r.lines.map((l) => `${l.productId}x${l.quantity}`).sort().join(",");
const sameLines = (a: Recommendation, b: Recommendation) => lineKey(a) === lineKey(b);

const rupees = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);

/** One plain line built from the two bundles, so it can't claim anything they don't show. */
function compare(option: Recommendation, recommended: Recommendation): string {
  const delta = option.totals.monthly - recommended.totals.monthly;
  const changes: string[] = [];
  for (const role of ["link", "mobile"] as const) {
    const now = option.lines.find((l) => l.role === role);
    const before = recommended.lines.find((l) => l.role === role);
    if (now && before && now.productId !== before.productId) changes.push(`${now.name} instead of ${before.name}`);
    if (role === "mobile" && now && before && now.quantity !== before.quantity) {
      changes.push(`${now.quantity} mobile ${now.quantity === 1 ? "line" : "lines"} instead of ${before.quantity}`);
    }
  }
  const lead = delta <= 0 ? `Saves ${rupees(-delta)} a month` : `${rupees(delta)} more a month`;
  return changes.length ? `${lead}: ${changes.join(", ")}.` : `${lead}.`;
}

/** The option the customer picked, or a 400 if this customer isn't offered that bundle. */
export function chosenBundle(recommender: Recommender, questionSet: QuestionSet, answers: Answers, tier: BundleTier): BundleOption | null {
  const options = bundleOptions(recommender, questionSet, answers);
  if (!options) return null;
  const option = options.find((o) => o.tier === tier);
  if (!option) throw new ApiError(400, "invalid_bundle", `There's no ${TIER_LABELS[tier]} bundle for this business.`);
  return option;
}
