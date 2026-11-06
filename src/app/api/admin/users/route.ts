import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdmin, requirePrimaryAdmin } from "@/lib/auth/session";
import { ApiError, parseBody, route } from "@/lib/http";

const Body = z.object({ email: z.email().toLowerCase(), password: z.string().min(8).max(72) });

export const POST = route(async (request) => {
  await requirePrimaryAdmin();
  const { email, password } = await parseBody(request, Body);
  const { data, error } = await createAdmin(email, password);
  if (error) throw new ApiError(error.code === "email_exists" ? 409 : 400, error.code ?? "create_failed", error.message);
  return NextResponse.json({ user: { id: data.user.id, email: data.user.email } }, { status: 201 });
});
