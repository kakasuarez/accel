import 'server-only';
import type { SessionUser } from '../auth/session';
import { latestKycCheck, type KycCheck } from '../kyc/store';
import { listEvents, listLeadsForUser, type LeadRow } from '../leads/repository';
import { customerLead, intakeState } from '../leads/views';
import { getQuestions } from '../questions';
import { getRecommender } from '../recommender';
import { buildTracker, type Tracker } from './tracker';

export type CustomerLead = ReturnType<typeof customerLead>;
export type IntakeState = ReturnType<typeof intakeState>;

export interface DashboardData {
  user: { email: string };
  tracker: Tracker;
  lead: CustomerLead | null;
  intake: IntakeState | null;
  latestKyc: KycCheck | null;
}

/** The lead the dashboard follows: the newest open one, otherwise the newest one at all. */
const focusLead = (leads: readonly LeadRow[]) => leads.find((l) => l.status === 'open') ?? leads[0] ?? null;

export async function dashboardData(user: SessionUser): Promise<DashboardData> {
  const row = focusLead(await listLeadsForUser(user.id));
  if (!row) return { user: { email: user.email }, tracker: buildTracker({ lead: null, hasNextQuestion: false, latestKyc: null }), lead: null, intake: null, latestKyc: null };

  const [events, latestKyc] = await Promise.all([listEvents(row.id), latestKycCheck(row.id)]);
  // The dashboard is in English, whatever language the bot ran in.
  const intake = intakeState(row, getRecommender(), getQuestions(), 'en');
  const tracker = buildTracker({
    lead: { id: row.id, stage: row.stage, status: row.status, accepted: row.quote != null },
    hasNextQuestion: intake.nextQuestion != null,
    latestKyc,
  });
  return { user: { email: user.email }, tracker, lead: customerLead(row, events), intake, latestKyc };
}

/**
 * The lead /bot should continue when opened without ?lead=: the newest open lead that hasn't been accepted.
 * Returns null when the customer should start a new one.
 */
export async function resumableLeadId(user: SessionUser): Promise<string | null> {
  const lead = (await listLeadsForUser(user.id)).find((l) => l.status === 'open' && l.quote == null);
  return lead?.id ?? null;
}
