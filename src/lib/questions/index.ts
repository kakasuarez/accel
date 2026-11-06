import { getRecommender } from "../recommender";
import { buildQuestions } from "./build";
import type { QuestionSet } from "./types";

const cache = globalThis as { __accelQuestions?: QuestionSet };

export function getQuestions(): QuestionSet {
  cache.__accelQuestions ??= buildQuestions(getRecommender());
  return cache.__accelQuestions;
}
