export type Phase = "profile" | "add_ons" | "contact";
export type QuestionType = "single_select" | "boolean" | "integer" | "number" | "text" | "phone";
export type AnswerValue = string | number | boolean | null;

export interface Option {
  value: string | boolean;
  label: string;
  /** For add-ons: the `needs` value this option sets. Null leaves it unanswered. */
  sets?: boolean | null;
}

export interface Question {
  id: string;
  phase: Phase;
  question: string;
  type: QuestionType;
  required: boolean;
  /** natural_language: free text the LLM maps to a valid value. form: stored as typed, never sent to the LLM. */
  answerMode: "natural_language" | "form";
  options?: Option[];
  /** The customer's own value is valid when no option fits. */
  allowOther?: boolean;
  /** Present when "I don't know" is a valid answer. Stored as null. */
  skipOption?: { value: null; label: string };
  min?: number;
  unit?: string;
  maxLength?: number;
  productId?: string;
  eligibility?: {
    segments: readonly string[];
    cityTiers: readonly number[];
    minEmployees: number;
    minSites: number;
    requiresGstin: boolean;
    requiresOneOf: readonly string[];
  };
}

export interface QuestionSet {
  maxAddOnQuestions: number;
  questions: Question[];
}

export type Answers = Readonly<Record<string, AnswerValue>>;
