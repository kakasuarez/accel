import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { route } from "@/lib/http";
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

/** Starts a new set of questions. */
export const POST = route(async () => {
  const user = await requireUser();
  const lead = await createLead(user.id);
  return NextResponse.json(intakeState(lead, getRecommender(), getQuestions()), { status: 201 });
});
