import type postgres from "postgres";
import { db } from "../db";
import type { Answers, AnswerValue } from "../questions/types";
import type { Recommendation, ProductId, BundleTotals } from "../recommender";
import type { BundleTier } from "./quote";
import type { LeadStage } from "./stages";

export interface AcceptedQuote {
  /** The bundle the customer accepted. */
  recommendation: Recommendation;
  /** Which of the bundle options it was. Missing on quotes accepted before there were options. */
  bundle?: BundleTier;
  selectedAddOns: ProductId[];
  totals: BundleTotals;
}

export interface LeadRow {
  id: string;
  user_id: string;
  answers: Answers;
  stage: LeadStage | null;
  status: "open" | "closed";
  close_reason: string | null;
  explanation: string | null;
  business_name: string | null;
  contact_name: string | null;
  phone: string | null;
  quote: AcceptedQuote | null;
  created_at: string;
  updated_at: string;
}

export interface LeadEventRow {
  stage: LeadStage | null;
  status: string;
  created_at: string;
}

const json = (value: unknown) => db().json(value as postgres.JSONValue);

async function recordEvent(sql: postgres.Sql | postgres.TransactionSql, lead: LeadRow, changedBy: string | null) {
  await sql`insert into lead_events (lead_id, stage, status, changed_by) values (${lead.id}, ${lead.stage}, ${lead.status}, ${changedBy})`;
}

export async function createLead(userId: string): Promise<LeadRow> {
  const [lead] = await db()<LeadRow[]>`insert into leads (user_id) values (${userId}) returning *`;
  return lead!;
}

export async function getLead(id: string): Promise<LeadRow | null> {
  const [lead] = await db()<LeadRow[]>`select * from leads where id = ${id}`;
  return lead ?? null;
}

export const listLeadsForUser = (userId: string) => db()<LeadRow[]>`select * from leads where user_id = ${userId} order by created_at desc`;

export const listAllLeads = () =>
  db()<(LeadRow & { email: string })[]>`select l.*, u.email from leads l join auth.users u on u.id = l.user_id where l.stage is not null order by l.updated_at desc`;

export const listEvents = (leadId: string) =>
  db()<LeadEventRow[]>`select stage, status, created_at from lead_events where lead_id = ${leadId} order by id`;

/** Clears the explanation, because the answers behind it have changed. */
export async function saveAnswer(leadId: string, questionId: string, value: AnswerValue): Promise<LeadRow> {
  const [lead] = await db()<LeadRow[]>`
    update leads set answers = answers || ${json({ [questionId]: value })}, explanation = null, updated_at = now()
    where id = ${leadId} returning *`;
  return lead!;
}

export async function saveExplanation(leadId: string, explanation: string): Promise<void> {
  await db()`update leads set explanation = ${explanation} where id = ${leadId}`;
}

/** The one path that moves a lead between stages, so a future KYC integration can call it too. */
export async function setStage(leadId: string, stage: LeadStage, changedBy: string | null): Promise<LeadRow> {
  return db().begin(async (sql) => {
    const [lead] = await sql<LeadRow[]>`update leads set stage = ${stage}, updated_at = now() where id = ${leadId} returning *`;
    await recordEvent(sql, lead!, changedBy);
    return lead!;
  });
}

export async function acceptQuote(leadId: string, stage: LeadStage, contact: { businessName: string; contactName: string; phone: string }, quote: AcceptedQuote): Promise<LeadRow> {
  return db().begin(async (sql) => {
    const [lead] = await sql<LeadRow[]>`
      update leads set stage = ${stage}, business_name = ${contact.businessName}, contact_name = ${contact.contactName},
        phone = ${contact.phone}, quote = ${json(quote)}, updated_at = now()
      where id = ${leadId} returning *`;
    await recordEvent(sql, lead!, null);
    return lead!;
  });
}

export async function closeLead(leadId: string, reason: string, changedBy: string): Promise<LeadRow> {
  return db().begin(async (sql) => {
    const [lead] = await sql<LeadRow[]>`update leads set status = 'closed', close_reason = ${reason}, updated_at = now() where id = ${leadId} returning *`;
    await recordEvent(sql, lead!, changedBy);
    return lead!;
  });
}
