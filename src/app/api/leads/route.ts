import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ApiError, route } from "@/lib/http";
import { DEFAULT_LANG, LANGS } from "@/lib/i18n/languages";
import { createLead, listEvents, listLeadsForUser } from "@/lib/leads/repository";
import { customerLead, intakeState } from "@/lib/leads/views";
import { getQuestions } from "@/lib/questions";
import { getRecommender } from "@/lib/recommender";

/** The tracker: every lead the customer has submitted answers for. */
export const GET = route(async () => {
  const user = await requireUser();
  const leads = await listLeadsForUser(user.id);
  return NextResponse.json({ leads: await Promise.all(leads.map(async (lead) => customerLead(lead, await listEvents(lead.id)))) });
});

const Body = z.object({ language: z.enum(LANGS).default(DEFAULT_LANG) });

/** Starts a new set of questions, in the language the customer picked (English if none was sent). */
export const POST = route(async (request) => {
  const user = await requireUser();
  // The body is optional: older clients send none.
  const text = await request.text();
  let body: unknown = {};
  try {
    if (text.trim()) body = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_request", "The request body must be JSON.");
  }
  const { language } = Body.parse(body);
  const lead = await createLead(user.id, language);
  return NextResponse.json(intakeState(lead, getRecommender(), getQuestions()), { status: 201 });
});
