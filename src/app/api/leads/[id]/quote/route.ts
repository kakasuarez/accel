import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ApiError, parseBody, route } from "@/lib/http";
import { localizeRecommendation } from "@/lib/i18n/localize";
import { ownLead } from "@/lib/leads/access";
import { BUNDLE_TIERS, chosenBundle, priceSelection } from "@/lib/leads/quote";
import { leadLanguage } from "@/lib/leads/repository";
import { getQuestions } from "@/lib/questions";
import { customerView, getRecommender } from "@/lib/recommender";

const Body = z.object({ selectedAddOns: z.array(z.string()).max(50), bundle: z.enum(BUNDLE_TIERS).default("recommended") });

/**
 * Prices one of the bundle options with the customer's ticked add-ons. Saves nothing. Add-ons the bundle
 * doesn't allow are left out and listed, since switching bundle can change which add-ons are available.
 */
export const POST = route(async (request, { params }: RouteContext<"/api/leads/[id]/quote">) => {
  const user = await requireUser();
  const { selectedAddOns, bundle } = await parseBody(request, Body);
  const lead = await ownLead(user, (await params).id);
  const recommender = getRecommender();
  const option = chosenBundle(recommender, getQuestions(), lead.answers, bundle);
  if (!option) throw new ApiError(409, "not_ready", "Please finish the questions first.");
  const recommendation = localizeRecommendation(customerView(option.recommendation), leadLanguage(lead), recommender.catalogue);
  return NextResponse.json({ ...priceSelection(option.recommendation, selectedAddOns, recommender.catalogue), recommendation });
});
