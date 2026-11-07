import { productQuestion, type Recommender } from "../recommender";
import type { Option, Question, QuestionSet } from "./types";

const MAX_ADD_ON_QUESTIONS = 4;
const YES_NO: Option[] = [
  { value: true, label: "Yes" },
  { value: false, label: "No" },
];
const NOT_SURE = { value: null, label: "Not sure" };
const options = (values: readonly string[]): Option[] => values.map((value) => ({ value, label: value }));

/** Built from the live catalogue and leads, so a CSV change reaches the questions without a code change. */
export function buildQuestions({ businessTypes, cities, currentInternetTypes, catalogue }: Recommender): QuestionSet {
  const natural = { answerMode: "natural_language" } as const;
  const profile: Question[] = [
    { ...natural, id: "businessType", phase: "profile", question: "What kind of business do you run?", type: "single_select", required: true, allowOther: true, options: options(businessTypes), hint: "You can just describe what you sell or do, for example \"we run a clinic\" or \"we make furniture\"." },
    { ...natural, id: "employees", phase: "profile", question: "How many people work in the business?", type: "integer", required: true, min: 1, hint: "A rough estimate is fine, including the owner." },
    { ...natural, id: "sites", phase: "profile", question: "How many locations do you operate from?", type: "integer", required: true, min: 1, hint: "Count each shop, office, branch or factory. A rough number is fine." },
    { ...natural, id: "city", phase: "profile", question: "Which city is your business in? If you have several, tell us the smallest one.", type: "single_select", required: true, allowOther: true, options: options(cities), hint: "Just the city name is enough, for example Pune. It tells us which services are available there." },
    { ...natural, id: "hasGstin", phase: "profile", question: "Is your business registered for GST?", type: "boolean", required: false, options: YES_NO, skipOption: NOT_SURE },
    { ...natural, id: "currentInternet", phase: "profile", question: "What internet connection do you use today?", type: "single_select", required: false, options: options(currentInternetTypes), skipOption: NOT_SURE },
    { ...natural, id: "monthlyTelecomSpend", phase: "profile", question: "Roughly how much do you spend on phone and internet each month, in rupees?", type: "number", required: false, min: 0, unit: "INR per month", skipOption: NOT_SURE, hint: "A rough figure is fine." },
    { ...natural, id: "heavyBandwidth", phase: "profile", question: "Does your business use the internet a lot, for things like video calls, sending big files or working online all day?", type: "boolean", required: false, options: YES_NO, skipOption: NOT_SURE },
  ];
  const addOns = catalogue.products
    .filter((product) => product.role === "add_on")
    .map((product): Question => ({
      ...natural,
      id: addOnQuestionId(product.id),
      phase: "add_ons",
      productId: product.id,
      question: productQuestion(product),
      // The question asks about a need, so tell the LLM which product it's for: "we already have one" then makes sense.
      about: `${product.name}: ${product.description}`,
      type: "single_select",
      required: false,
      options: [
        { value: "yes", label: "Yes", sets: true },
        { value: "no", label: "No", sets: false },
        { value: "already_have", label: "I already have this", sets: false },
        { value: "not_sure", label: "Not sure", sets: null },
      ],
      eligibility: {
        segments: product.targetSegments,
        cityTiers: product.cityTiers,
        minEmployees: product.minEmployees,
        minSites: product.minSites,
        requiresGstin: product.requiresGstin,
        requiresOneOf: product.requiresOneOf,
      },
    }));
  const form = { answerMode: "form", required: true, phase: "contact" } as const;
  const contact: Question[] = [
    { ...form, id: "businessName", question: "What is your business called?", type: "text", maxLength: 120 },
    { ...form, id: "contactName", question: "Who should we speak to?", type: "text", maxLength: 120 },
    { ...form, id: "phone", question: "What is the best phone number to reach you on?", type: "phone" },
  ];
  return { maxAddOnQuestions: MAX_ADD_ON_QUESTIONS, questions: [...profile, ...addOns, ...contact] };
}

export const addOnQuestionId = (productId: string) => `need:${productId}`;
