import type { SessionUser } from "../auth/session";
import { ApiError } from "../http";
import { getLead, type LeadRow } from "./repository";

const NOT_FOUND = new ApiError(404, "not_found", "We couldn't find that lead.");

/** The caller's own lead. Someone else's looks the same as one that doesn't exist. */
export async function ownLead(user: SessionUser, id: string): Promise<LeadRow> {
  const lead = await findLead(id);
  if (lead.user_id !== user.id) throw NOT_FOUND;
  return lead;
}

export async function findLead(id: string): Promise<LeadRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw NOT_FOUND;
  const lead = await getLead(id);
  if (!lead) throw NOT_FOUND;
  return lead;
}
