import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { route } from "@/lib/http";
import { ownLead } from "@/lib/leads/access";
import { listEvents } from "@/lib/leads/repository";
import { customerLead, intakeState } from "@/lib/leads/views";
import { getQuestions } from "@/lib/questions";
import { getRecommender } from "@/lib/recommender";

export const GET = route(async (_request, { params }: RouteContext<"/api/leads/[id]">) => {
  const user = await requireUser();
  const lead = await ownLead(user, (await params).id);
  return NextResponse.json({ ...intakeState(lead, getRecommender(), getQuestions()), lead: customerLead(lead, await listEvents(lead.id)) });
});
