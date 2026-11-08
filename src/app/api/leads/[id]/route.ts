import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ApiError, parseBody, route } from "@/lib/http";
import { LANGS } from "@/lib/i18n/languages";
import { ownLead } from "@/lib/leads/access";
import { listEvents, setLanguage } from "@/lib/leads/repository";
import { customerLead, intakeState } from "@/lib/leads/views";
import { getQuestions } from "@/lib/questions";
import { getRecommender } from "@/lib/recommender";

export const GET = route(async (_request, { params }: RouteContext<"/api/leads/[id]">) => {
  const user = await requireUser();
  const lead = await ownLead(user, (await params).id);
  return NextResponse.json({ ...intakeState(lead, getRecommender(), getQuestions()), lead: customerLead(lead, await listEvents(lead.id)) });
});

const Patch = z.object({ language: z.enum(LANGS) });

/** Changes the conversation's language. Only before the first answer, so the whole conversation is in one language. */
export const PATCH = route(async (request, { params }: RouteContext<"/api/leads/[id]">) => {
  const user = await requireUser();
  const { language } = await parseBody(request, Patch);
  const lead = await ownLead(user, (await params).id);
  if (lead.quote) throw new ApiError(409, "already_accepted", "This quote has already been accepted.");
  if (Object.keys(lead.answers).length > 0) throw new ApiError(409, "already_started", "The language can only be changed before the first answer.");
  const updated = lead.language === language ? lead : await setLanguage(lead.id, language);
  return NextResponse.json({ ...intakeState(updated, getRecommender(), getQuestions()), lead: customerLead(updated, await listEvents(lead.id)) });
});
