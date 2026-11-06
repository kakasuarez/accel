/** Writes docs/questions.json for reference. The running site builds the same data itself at startup. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildQuestions } from "../src/lib/questions/build";
import { loadRecommender } from "../src/lib/recommender";

const root = resolve(import.meta.dirname, "..");
const questions = buildQuestions(loadRecommender(root, { trees: 1 }));
writeFileSync(resolve(root, "docs/questions.json"), `${JSON.stringify(questions, null, 2)}\n`);
console.log(`Wrote ${questions.questions.length} questions to docs/questions.json`);
