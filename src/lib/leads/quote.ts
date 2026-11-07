import { addOnQuestionId } from "../questions/build";
import type { Answers, Question, QuestionSet } from "../questions/types";
import type { BusinessProfile, Catalogue, Flag, Recommendation, Recommender } from "../recommender";

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
export function recommendationFor(recommender: Recommender, questionSet: QuestionSet, answers: Answers): Recommendation | null {
  if (!profileComplete(questionSet, answers)) return null;
  const recommendation = recommender.recommend(toProfile(recommender, questionSet, answers));
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
