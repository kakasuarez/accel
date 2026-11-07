import { customerView, type Recommender } from "../recommender";
import type { Question, QuestionSet } from "../questions/types";
import { bundleOptions, nextQuestion, recommendationFor } from "./quote";
import type { LeadEventRow, LeadRow } from "./repository";
import { LEAD_STAGES } from "./stages";

function accepted(quote: NonNullable<LeadRow["quote"]>) {
  const view = customerView(quote.recommendation);
  return {
    // Quotes accepted before there were bundle options were all the recommended bundle.
    bundle: quote.bundle ?? "recommended",
    lines: view.lines,
    addOns: view.addOns.filter((a) => quote.selectedAddOns.includes(a.productId)),
    totals: quote.totals,
    flags: view.flags,
  };
}

const history = (events: readonly LeadEventRow[]) => events.map(({ stage, status, created_at }) => ({ stage, status, at: created_at }));

/** The tracker's view. Internal flags and the close reason are never included. */
export function customerLead(lead: LeadRow, events: readonly LeadEventRow[]) {
  return {
    id: lead.id,
    stage: lead.stage,
    status: lead.status,
    stages: LEAD_STAGES,
    history: history(events),
    businessName: lead.business_name,
    contactName: lead.contact_name,
    phone: lead.phone,
    quote: lead.quote && accepted(lead.quote),
    createdAt: lead.created_at,
  };
}

export function adminLead(lead: LeadRow & { email?: string }, events: readonly LeadEventRow[]) {
  return {
    ...customerLead(lead, events),
    email: lead.email,
    answers: lead.answers,
    closeReason: lead.close_reason,
    internalFlags: lead.quote?.recommendation.flags.filter((flag) => flag.audience === "internal") ?? [],
  };
}

/** What a question looks like to the frontend. Catalogue rules stay on the server. */
const publicQuestion = ({ id, phase, question, type, options, min, unit, skipOption }: Question) => ({
  id,
  phase,
  question,
  type,
  options: options?.map(({ value, label }) => ({ value, label })),
  min,
  unit,
  canSkip: !!skipOption,
});

/** Where the customer has got to: the next question, and the recommendation once there is one. */
export function intakeState(lead: LeadRow, recommender: Recommender, questionSet: QuestionSet) {
  const recommendation = recommendationFor(recommender, questionSet, lead.answers);
  const next = nextQuestion(questionSet, lead.answers, recommendation);
  // Built once the questions are done: the customer picks one of these, Recommended first.
  const bundles = recommendation && !next ? bundleOptions(recommender, questionSet, lead.answers) : null;
  return {
    leadId: lead.id,
    stage: lead.stage,
    answers: lead.answers,
    nextQuestion: next && publicQuestion(next),
    recommendation: recommendation && customerView(recommendation),
    bundles: bundles?.map(({ tier, label, comparison, recommendation: r }) => ({ tier, label, comparison, recommendation: customerView(r) })) ?? null,
    explanation: lead.explanation,
  };
}
