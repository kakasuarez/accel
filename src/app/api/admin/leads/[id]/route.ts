import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { ApiError, parseBody, route } from "@/lib/http";
import { findLead } from "@/lib/leads/access";
import { closeLead, listEvents, setStage } from "@/lib/leads/repository";
import { LEAD_STAGES, canAdvance } from "@/lib/leads/stages";
import { adminLead } from "@/lib/leads/views";

const Body = z.union([z.strictObject({ stage: z.enum(LEAD_STAGES) }), z.strictObject({ closeReason: z.string().trim().min(1).max(500) })]);

/** Moves a lead to its next stage, or closes it. Closed leads can't change. */
export const PATCH = route(async (request, { params }: RouteContext<"/api/admin/leads/[id]">) => {
  const admin = await requireAdmin();
  const change = await parseBody(request, Body);
  const lead = await findLead((await params).id);
  if (lead.status === "closed") throw new ApiError(409, "closed", "This lead is closed.");

  if ("closeReason" in change) {
    const updated = await closeLead(lead.id, change.closeReason, admin.id);
    return NextResponse.json({ lead: adminLead(updated, await listEvents(lead.id)) });
  }
  if (!canAdvance(lead.stage, change.stage)) throw new ApiError(409, "invalid_stage", `A lead at "${lead.stage ?? "no stage"}" can't move to "${change.stage}".`);
  const updated = await setStage(lead.id, change.stage, admin.id);
  return NextResponse.json({ lead: adminLead(updated, await listEvents(lead.id)) });
});
