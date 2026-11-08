// Puts what the customer sees into their language at the API boundary. Values, ids, prices and product names
// never change: the stored answers, the recommender and the admin views stay in English.
import { comparisonChanges, comparisonText, tierLabelKey, type BundleOption, type Comparison } from "../leads/quote";
import type { Question } from "../questions/types";
import type { Catalogue, CustomerRecommendation, Flag } from "../recommender";
import type { MessageKey } from "../recommender/messages";
import { contentMessage, descriptionKey, hintKey, questionKey, translate, translateLabel } from "./content";
import type { Vars } from "./format";
import type { Lang } from "./languages";

/** A question's text, hint and labels in the customer's language. */
export function localizeQuestion(question: Question, lang: Lang): Question {
  if (lang === "en") return question;
  return {
    ...question,
    question: translate(lang, questionKey(question.id), question.question),
    hint: question.hint && translate(lang, hintKey(question.id), question.hint),
    options: question.options?.map((option) => ({ ...option, label: translateLabel(lang, option.label) })),
    skipOption: question.skipOption && { ...question.skipOption, label: translateLabel(lang, question.skipOption.label) },
  };
}

const message = (lang: Lang) => (key: MessageKey, vars?: Vars) => contentMessage(lang, key, vars);

/** Template values that are themselves labels we translate: a segment name, or a known city. */
const LABEL_PARAMS = new Set(["segment", "city"]);
const localizeParams = (lang: Lang, params: Vars | undefined): Vars | undefined =>
  params && Object.fromEntries(Object.entries(params).map(([k, v]) => [k, LABEL_PARAMS.has(k) && typeof v === "string" ? translateLabel(lang, v) : v]));

/** Flags saved before they carried a template are shown as they were written. */
const localizeFlag = (lang: Lang, flag: Flag): Flag =>
  flag.template ? { ...flag, message: contentMessage(lang, flag.template, localizeParams(lang, flag.params)) } : flag;

export function localizeRecommendation(view: CustomerRecommendation, lang: Lang, catalogue: Catalogue): CustomerRecommendation {
  if (lang === "en") return view;
  /** `why` is the catalogue description for every line and most add-ons; anything else is left as it is. */
  const description = (productId: string, why: string) => {
    const english = catalogue.byId.get(productId)?.description;
    return english === undefined ? why : translate(lang, descriptionKey(productId), english);
  };
  const isDescription = (productId: string, why: string) => why === catalogue.byId.get(productId)?.description;
  return {
    ...view,
    segmentLabel: translateLabel(lang, view.segmentLabel),
    lines: view.lines.map((line) => (isDescription(line.productId, line.why) ? { ...line, why: description(line.productId, line.why) } : line)),
    addOns: view.addOns.map((addOn) => {
      if (addOn.sharePercent && catalogue.byId.has(addOn.productId)) {
        return { ...addOn, why: contentMessage(lang, "addOn.share", { description: description(addOn.productId, addOn.why), percent: addOn.sharePercent }) };
      }
      return isDescription(addOn.productId, addOn.why) ? { ...addOn, why: description(addOn.productId, addOn.why) } : addOn;
    }),
    blocked: view.blocked.map((b) => (b.params ? { ...b, reason: contentMessage(lang, `block.${b.code}`, b.params) } : b)),
    flags: view.flags.map((flag) => localizeFlag(lang, flag)),
  };
}

export const localizeTierLabel = (lang: Lang, tier: BundleOption["tier"]) => contentMessage(lang, tierLabelKey(tier));

/** The comparison line in the customer's language. */
export function localizeComparison(lang: Lang, parts: Comparison | null, english: string | null): string | null {
  if (!parts || lang === "en") return english;
  return comparisonText(parts, message(lang));
}

/** Just the changes, for the explanation's "Compared with…" sentence. */
export const localizeComparisonChanges = (lang: Lang, parts: Comparison) => comparisonChanges(parts, message(lang));
