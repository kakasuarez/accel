import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { route } from "@/lib/http";

export const GET = route(async () => NextResponse.json({ user: await requireUser() }));
