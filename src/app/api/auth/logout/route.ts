import { NextResponse } from "next/server";
import { supabaseForRequest } from "@/lib/auth/supabase";
import { route } from "@/lib/http";

export const POST = route(async () => {
  const supabase = await supabaseForRequest();
  await supabase.auth.signOut();
  return new NextResponse(null, { status: 204 });
});
