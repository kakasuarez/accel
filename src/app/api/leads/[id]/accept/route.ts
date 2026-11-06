import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ApiError, parseBody, route } from "@/lib/http";
import { ownLead } from "@/lib/leads/access";
import { nextQuestion, recommendationFor } from "@/lib/leads/quote";
import { acceptQuote, listEvents } from "@/lib/leads/repository";
import { STAGE_AFTER_QUOTE } from "@/lib/leads/stages";
import { customerLead } from "@/lib/leads/views";
import { getQuestions } from "@/lib/questions";
import { getRecommender, priceWithAddOns } from "@/lib/recommender";

const Body = z.object({
  selectedAddOns: z.array(z.string()).max(50),
  businessName: z.string().trim().min(1).max(120),
  contactName: z.string().trim().min(1).max(120),
  phone: z.string().trim().regex(/^\+?[0-9][0-9 ()-]{6,19}$/, "Enter a valid phone number"),
});

/** Prices are recalculated here: nothing about the quote is taken from the browser. */
export const POST = route(async (request, { params }: RouteContext<"/api/leads/[id]/accept">) => {
  const user = await requireUser();
  const { selectedAddOns, ...contact } = await parseBody(request, Body);
  const lead = await ownLead(user, (await params).id);
  if (lead.quote) throw new ApiError(409, "already_accepted", "This quote has already been accepted.");

  const questions = getQuestions();
  const recommendation = recommendationFor(getRecommender(), questions, lead.answers);
  if (!recommendation || nextQuestion(questions, lead.answers, recommendation)) {
    throw new ApiError(409, "not_ready", "Please finish the questions first.");
  }

  let totals;
  try {
    totals = priceWithAddOns(recommendation, selectedAddOns);
  } catch (error) {
    if (error instanceof RangeError) throw new ApiError(400, "invalid_add_on", error.message);
    throw error;
  }
  const updated = await acceptQuote(lead.id, STAGE_AFTER_QUOTE, contact, { recommendation, selectedAddOns: [...new Set(selectedAddOns)], totals });
  return NextResponse.json({ lead: customerLead(updated, await listEvents(lead.id)) });
});
