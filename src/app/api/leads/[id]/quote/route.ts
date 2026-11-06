import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ApiError, parseBody, route } from "@/lib/http";
import { ownLead } from "@/lib/leads/access";
import { recommendationFor } from "@/lib/leads/quote";
import { getQuestions } from "@/lib/questions";
import { getRecommender, priceWithAddOns } from "@/lib/recommender";

const Body = z.object({ selectedAddOns: z.array(z.string()).max(50) });

/** Prices the customer's picker selection. Saves nothing. */
export const POST = route(async (request, { params }: RouteContext<"/api/leads/[id]/quote">) => {
  const user = await requireUser();
  const { selectedAddOns } = await parseBody(request, Body);
  const lead = await ownLead(user, (await params).id);
  const recommendation = recommendationFor(getRecommender(), getQuestions(), lead.answers);
  if (!recommendation) throw new ApiError(409, "not_ready", "Please finish the questions first.");
  return NextResponse.json({ totals: priced(recommendation, selectedAddOns) });
});

function priced(...args: Parameters<typeof priceWithAddOns>) {
  try {
    return priceWithAddOns(...args);
  } catch (error) {
    if (error instanceof RangeError) throw new ApiError(400, "invalid_add_on", error.message);
    throw error;
  }
}
