import 'server-only';
import { db } from '../db';
import type { Decision } from '../kyc/types';
import { recommendationFor } from '../leads/quote';
import type { AcceptedQuote, LeadRow } from '../leads/repository';
import type { LeadStage } from '../leads/stages';
import { getQuestions } from '../questions';
import { getRecommender } from '../recommender';
import { adminMetrics, type AdminMetrics, type LeadSummary, type Period } from './metrics';

interface EventRow {
  lead_id: string;
  stage: LeadStage | null;
  status: string;
  created_at: Date;
}

interface KycRow {
  lead_id: string;
  decision: Decision;
  created_at: Date;
}

/** Quotes accepted before single prices stored a min and max instead; those count at their minimum. */
const monthlyOf = (quote: AcceptedQuote | null) => {
  if (!quote) return null;
  const totals = quote.totals as AcceptedQuote['totals'] & { monthlyMin?: number };
  return totals.monthly ?? totals.monthlyMin ?? null;
};

/** Three queries, then everything is worked out in memory: fine for thousands of leads. */
export async function loadAdminMetrics(days: Period, now = new Date()): Promise<AdminMetrics> {
  const sql = db();
  const leads = await sql<LeadRow[]>`select * from leads where stage is not null`;
  const events = await sql<EventRow[]>`
    select e.lead_id, e.stage, e.status, e.created_at from lead_events e
    join leads l on l.id = e.lead_id where l.stage is not null order by e.id`;
  // Oldest first, so the first row per lead is its first attempt and the last is its newest.
  const kyc = await sql<KycRow[]>`select lead_id, decision, created_at from kyc_checks order by lead_id, created_at, id`;

  const eventsByLead = new Map<string, EventRow[]>();
  for (const event of events) eventsByLead.set(event.lead_id, [...(eventsByLead.get(event.lead_id) ?? []), event]);
  const firstKyc = new Map<string, KycRow>();
  const latestKyc = new Map<string, KycRow>();
  for (const check of kyc) {
    if (!firstKyc.has(check.lead_id)) firstKyc.set(check.lead_id, check);
    latestKyc.set(check.lead_id, check);
  }
  const toCheck = (row: KycRow | undefined) => (row ? { decision: row.decision, at: new Date(row.created_at) } : null);
  const recommender = getRecommender();
  const questions = getQuestions();

  const summaries = leads.map((lead): LeadSummary => {
    const reached: LeadSummary['reached'] = {};
    let closedAt: Date | null = null;
    for (const event of eventsByLead.get(lead.id) ?? []) {
      if (event.stage && !reached[event.stage]) reached[event.stage] = new Date(event.created_at);
      if (event.status === 'closed' && !closedAt) closedAt = new Date(event.created_at);
    }
    return {
      id: lead.id,
      createdAt: new Date(lead.created_at),
      stage: lead.stage,
      status: lead.status,
      closeReason: lead.close_reason,
      closedAt,
      segment: lead.quote?.recommendation.segmentLabel ?? segmentLabel(lead),
      bundle: lead.quote ? (lead.quote.bundle ?? 'unrecorded') : null,
      monthly: monthlyOf(lead.quote),
      reached,
      kyc: toCheck(latestKyc.get(lead.id)),
      firstKyc: toCheck(firstKyc.get(lead.id)),
    };
  });
  return adminMetrics(summaries, now, days);

  function segmentLabel(lead: LeadRow): string | null {
    try {
      return recommendationFor(recommender, questions, lead.answers)?.segmentLabel ?? null;
    } catch {
      return null;
    }
  }
}
