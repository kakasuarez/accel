// Every English string a customer can see in Accel Bot, by translation key. `npm run translate` translates
// these, and tests/unit/locales.test.ts checks the locale files against them. Like speakableLines(), this reads
// only the catalogue and training CSVs: no database or LLM.
import { getQuestions } from "../questions";
import { getRecommender } from "../recommender";
import { CONTENT_MESSAGES, descriptionKey, hintKey, labelKey, questionKey } from "./content";
import { SCRIPT_SOURCE, UI, quantityKey, quantityTemplates, unitKey } from "./ui";

export type Source = Record<string, string>;

/** For data/locales/content: questions, option labels, segment names, catalogue descriptions and the server's sentences. */
export function contentSource(): Source {
  const source: Source = { ...CONTENT_MESSAGES };
  const recommender = getRecommender();
  for (const question of getQuestions().questions) {
    if (question.phase === "contact") continue; // a form on the result screen, labelled in UI
    source[questionKey(question.id)] = question.question;
    if (question.hint) source[hintKey(question.id)] = question.hint;
    for (const option of question.options ?? []) source[labelKey(option.label)] = option.label;
    if (question.skipOption) source[labelKey(question.skipOption.label)] = question.skipOption.label;
  }
  for (const label of recommender.segmentLabels) source[labelKey(label)] = label;
  for (const product of recommender.catalogue.products) source[descriptionKey(product.id)] = product.description;
  return source;
}

/** For data/locales/ui: the bot's lines, its screens, and the catalogue's units. */
export function uiSource(): Source {
  const source: Source = { ...SCRIPT_SOURCE, ...UI };
  for (const product of getRecommender().catalogue.products) {
    const templates = quantityTemplates(product.unit);
    source[quantityKey(product.unit, "one")] = templates.one;
    source[quantityKey(product.unit, "other")] = templates.other;
  }
  for (const question of getQuestions().questions) if (question.unit) source[unitKey(question.unit)] = question.unit;
  return source;
}
