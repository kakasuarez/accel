import 'server-only';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from '../db';
import type { Decision } from '../kyc/types';
import { recommendationFor } from '../leads/quote';
import type { AcceptedQuote, LeadRow } from '../leads/repository';
import type { LeadStage } from '../leads/stages';
import { getQuestions } from '../questions';
import { getRecommender, parseLeads } from '../recommender';
import { adminMetrics, type AdminMetrics, type LeadSummary, type Period } from './metrics';
import { callList, trainPropensity, type CallList, type PropensityModel } from './propensity';

export type AdminData = AdminMetrics & { calls: CallList };

// On globalThis, like the recommender, so it's trained once per cold start.
const cache = globalThis as { __accelPropensity?: PropensityModel };
function propensityModel(): PropensityModel {
  const file = resolve(process.env.ACCEL_DATA_DIR ?? process.cwd(), 'training_leads.csv');
  cache.__accelPropensity ??= trainPropensity(parseLeads(readFileSync(/* turbopackIgnore: true */ file, 'utf8')));
  return cache.__accelPropensity;
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const later = (a: Date, b: Date | undefined) => (b && b > a ? b : a);

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
export async function loadAdminMetrics(days: Period, now = new Date()): Promise<AdminData> {
  const sql = db();
  const leads = await sql<(LeadRow & { email: string | null })[]>`
    select l.*, u.email from leads l left join auth.users u on u.id = l.user_id where l.stage is not null`;
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
    let lastActivityAt = new Date(lead.created_at);
    for (const event of eventsByLead.get(lead.id) ?? []) {
      const at = new Date(event.created_at);
      if (event.stage && !reached[event.stage]) reached[event.stage] = at;
      if (event.status === 'closed' && !closedAt) closedAt = at;
      lastActivityAt = later(lastActivityAt, at);
    }
    const kyc = toCheck(latestKyc.get(lead.id));
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
      kyc,
      firstKyc: toCheck(firstKyc.get(lead.id)),
      lastActivityAt: later(lastActivityAt, kyc?.at),
      profile: {
        businessType: text(lead.answers.businessType),
        city: text(lead.answers.city),
        hasGstin: typeof lead.answers.hasGstin === 'boolean' ? lead.answers.hasGstin : null,
        currentInternet: text(lead.answers.currentInternet),
      },
      contact: { business: text(lead.business_name), name: text(lead.contact_name), phone: text(lead.phone), email: lead.email },
    };
  });
  return { ...adminMetrics(summaries, now, days), calls: callList(propensityModel(), summaries, now) };

  function segmentLabel(lead: LeadRow): string | null {
    try {
      return recommendationFor(recommender, questions, lead.answers)?.segmentLabel ?? null;
    } catch {
      return null;
    }
  }
}
