import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ApiError, route } from "@/lib/http";
import { ownLead } from "@/lib/leads/access";
import { explainRecommendation } from "@/lib/leads/explain";
import { BUNDLE_TIERS, chosenBundle } from "@/lib/leads/quote";
import { saveExplanation } from "@/lib/leads/repository";
import { createLlmClient } from "@/lib/llm/client";
import { getQuestions } from "@/lib/questions";
import { customerView, getRecommender } from "@/lib/recommender";

export const maxDuration = 60;

const Tier = z.enum(BUNDLE_TIERS).default("recommended");

/**
 * POST /api/leads/:id/explanation?bundle=budget
 * The Recommended explanation is written once per set of answers and saved. Budget and Premium ones are
 * written on request and not saved: the page keeps them while the customer compares bundles.
 */
export const POST = route(async (request, { params }: RouteContext<"/api/leads/[id]/explanation">) => {
  const user = await requireUser();
  const tier = Tier.parse(new URL(request.url).searchParams.get("bundle") ?? undefined);
  const lead = await ownLead(user, (await params).id);
  if (tier === "recommended" && lead.explanation) return NextResponse.json({ explanation: lead.explanation });

  const option = chosenBundle(getRecommender(), getQuestions(), lead.answers, tier);
  if (!option) throw new ApiError(409, "not_ready", "Please finish the questions first.");
  const alternative = option.comparison ? { label: option.label, comparison: option.comparison } : undefined;
  const explanation = await explainRecommendation(createLlmClient(), lead.answers, customerView(option.recommendation), alternative);
  if (tier === "recommended") await saveExplanation(lead.id, explanation);
  return NextResponse.json({ explanation });
});
