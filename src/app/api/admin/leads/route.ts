import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import { route } from "@/lib/http";
import { listAllLeads, listEvents } from "@/lib/leads/repository";
import { adminLead } from "@/lib/leads/views";

export const GET = route(async () => {
  await requireAdmin();
  const leads = await listAllLeads();
  return NextResponse.json({ leads: await Promise.all(leads.map(async (lead) => adminLead(lead, await listEvents(lead.id)))) });
});
