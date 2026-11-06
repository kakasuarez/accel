import { addOnQuestionId } from "../questions/build";
import type { Answers, Question, QuestionSet } from "../questions/types";
import type { BusinessProfile, Catalogue, Recommendation, Recommender } from "../recommender";

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
    currentInternet: String(answers.currentInternet),
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
  if (recommender.cityTierOf(city) !== undefined) return recommendation;
  return {
    ...recommendation,
    flags: [
      ...recommendation.flags,
      { code: "city_unconfirmed", audience: "customer", message: `Availability in ${city} is to be confirmed, so this quote may change.` },
    ],
  };
}
