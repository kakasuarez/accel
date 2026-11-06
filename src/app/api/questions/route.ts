import { NextResponse } from "next/server";
import { route } from "@/lib/http";
import { getQuestions } from "@/lib/questions";

export const GET = route(async () => NextResponse.json(getQuestions()));
