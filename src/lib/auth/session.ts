import { ApiError } from "../http";
import { supabaseAdmin, supabaseForRequest } from "./supabase";

export interface SessionUser {
  id: string;
  email: string;
  isAdmin: boolean;
  /** Only the account from ADMIN_EMAIL can create other admins. */
  isPrimaryAdmin: boolean;
}

export async function currentUser(): Promise<SessionUser | null> {
  const supabase = await supabaseForRequest();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  // app_metadata can only be changed with the secret key, unlike user_metadata.
  const isAdmin = data.user.app_metadata.role === "admin";
  const email = data.user.email ?? "";
  return { id: data.user.id, email, isAdmin, isPrimaryAdmin: isAdmin && email === process.env.ADMIN_EMAIL?.toLowerCase() };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new ApiError(401, "not_signed_in", "Please sign in.");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isAdmin) throw new ApiError(403, "forbidden", "You don't have access to this.");
  return user;
}

export async function requirePrimaryAdmin(): Promise<SessionUser> {
  const user = await requireAdmin();
  if (!user.isPrimaryAdmin) throw new ApiError(403, "forbidden", "Only the primary admin can do this.");
  return user;
}

export async function createAdmin(email: string, password: string) {
  return supabaseAdmin().auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: "admin" } });
}

/** Runs at each cold start. An existing account is left as it is, so ADMIN_PASSWORD only applies the first time. */
export async function ensurePrimaryAdmin(): Promise<void> {
  const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;
  if (!email || !password) {
    console.warn("ADMIN_EMAIL or ADMIN_PASSWORD isn't set, so no admin account was created.");
    return;
  }
  const { error } = await createAdmin(email.toLowerCase(), password);
  if (error && error.code !== "email_exists") console.error("Couldn't create the admin account:", error.message);
}
