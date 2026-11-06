import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseForRequest } from "@/lib/auth/supabase";
import { ApiError, parseBody, route } from "@/lib/http";

const Body = z.object({ email: z.email(), password: z.string().min(1).max(72) });

export const POST = route(async (request) => {
  const credentials = await parseBody(request, Body);
  const supabase = await supabaseForRequest();
  const { data, error } = await supabase.auth.signInWithPassword(credentials);
  if (error) throw new ApiError(401, "invalid_credentials", "That email or password is incorrect.");
  return NextResponse.json({ user: { id: data.user.id, email: data.user.email } });
});
