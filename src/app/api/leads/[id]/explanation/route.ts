import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { ApiError, route } from "@/lib/http";
import { ownLead } from "@/lib/leads/access";
import { explainRecommendation } from "@/lib/leads/explain";
import { recommendationFor } from "@/lib/leads/quote";
import { saveExplanation } from "@/lib/leads/repository";
import { createLlmClient } from "@/lib/llm/client";
import { getQuestions } from "@/lib/questions";
import { customerView, getRecommender } from "@/lib/recommender";

export const maxDuration = 60;

/** Written once per set of answers, then reused. */
export const POST = route(async (_request, { params }: RouteContext<"/api/leads/[id]/explanation">) => {
  const user = await requireUser();
  const lead = await ownLead(user, (await params).id);
  if (lead.explanation) return NextResponse.json({ explanation: lead.explanation });
  const recommendation = recommendationFor(getRecommender(), getQuestions(), lead.answers);
  if (!recommendation) throw new ApiError(409, "not_ready", "Please finish the questions first.");
  const explanation = await explainRecommendation(createLlmClient(), lead.answers, customerView(recommendation));
  await saveExplanation(lead.id, explanation);
  return NextResponse.json({ explanation });
});
