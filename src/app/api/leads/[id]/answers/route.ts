import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { ApiError, parseBody, route } from "@/lib/http";
import { ownLead } from "@/lib/leads/access";
import { nextQuestion, profileComplete, recommendationFor } from "@/lib/leads/quote";
import { leadLanguage, saveAnswer, setStage } from "@/lib/leads/repository";
import { STAGE_AFTER_PROFILE } from "@/lib/leads/stages";
import { intakeState } from "@/lib/leads/views";
import { createLlmClient } from "@/lib/llm/client";
import { getQuestions } from "@/lib/questions";
import { interpretAnswer } from "@/lib/questions/interpret";
import { getRecommender } from "@/lib/recommender";

export const maxDuration = 60;

const Body = z.object({ questionId: z.string().min(1), answer: z.string().trim().min(1).max(1000) });

/** The customer's words go to the LLM and are then discarded. Only the chosen value is saved. */
export const POST = route(async (request, { params }: RouteContext<"/api/leads/[id]/answers">) => {
  const user = await requireUser();
  const { questionId, answer } = await parseBody(request, Body);
  const lead = await ownLead(user, (await params).id);
  if (lead.quote) throw new ApiError(409, "already_accepted", "This quote has already been accepted.");

  const recommender = getRecommender();
  const questions = getQuestions();
  const question = nextQuestion(questions, lead.answers, recommendationFor(recommender, questions, lead.answers));
  if (question?.id !== questionId) throw new ApiError(409, "wrong_question", "That isn't the current question.");

  const result = await interpretAnswer(createLlmClient(), question, answer, leadLanguage(lead));
  if (result.status === "unclear") {
    return NextResponse.json({ status: "unclear", reason: result.reason, ...intakeState(lead, recommender, questions) });
  }

  let updated = await saveAnswer(lead.id, question.id, result.value);
  if (!updated.stage && profileComplete(questions, updated.answers)) updated = await setStage(lead.id, STAGE_AFTER_PROFILE, null);
  return NextResponse.json({ status: "answered", value: result.value, ...intakeState(updated, recommender, questions) });
});
