import type { LeadStage } from '../leads/stages';
import type { Decision } from '../kyc/types';

/**
 * The dashboard's "what next" tracker. Pure: it only reads the lead's state, so it can run on the server
 * page and in tests. Every step is derived from data the backend already keeps (stage history, quote, next
 * question, latest KYC attempt); nothing is stored for the tracker itself.
 *
 * Dates: a finished step shows when it was done. A step we're working on shows the date we promise:
 * REVIEW_DAYS after the documents went to manual review, and the bundle's install days (the slowest
 * product's typical_install_days in the catalogue) after KYC. Once that date passes the step is overdue and
 * the customer is pointed to the escalate button. Steps waiting on the customer have no date.
 */

const shortDate = (date: Date) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(date);

/** How long a manual KYC review takes, as promised to the customer. */
export const REVIEW_DAYS = 2;
const DAY = 24 * 60 * 60 * 1000;

export type StepKey = 'assess' | 'quote' | 'kyc' | 'activation';
export type StepState = 'done' | 'current' | 'todo';

export type StepDate =
  /** When the step was finished. */
  | { kind: 'done'; at: string }
  /** We're on it, and promise it by this date. */
  | { kind: 'expected'; by: string; overdue: boolean }
  /** Not started yet: how long it takes once it starts. */
  | { kind: 'after'; days: number };

export interface TrackerStep {
  key: StepKey;
  label: string;
  state: StepState;
  date: StepDate | null;
}

export type CurrentKind =
  | 'start'
  | 'questions'
  | 'review_quote'
  | 'kyc'
  | 'kyc_retry'
  | 'kyc_review'
  | 'activation'
  | 'done'
  | 'closed';

export interface TrackerCta {
  label: string;
  href: string;
}

export interface Tracker {
  steps: TrackerStep[];
  current: {
    kind: CurrentKind;
    step: StepKey | null;
    title: string;
    body: string;
    cta?: TrackerCta;
    /** Reasons from the latest rejected KYC attempt, shown so the customer knows what to fix. */
    reasons?: string[];
  };
  /**
   * Whether to offer the escalate button (calling support), between accepting a quote and being connected
   * while the request is open. `overdue` is true once a promised date has passed, so the button stands out.
   */
  escalation: { overdue: boolean } | null;
}

export interface TrackerLead {
  id: string;
  stage: LeadStage | null;
  status: 'open' | 'closed';
  /** True once the customer has accepted a quote. */
  accepted: boolean;
  /** When the lead first reached each stage (ISO). */
  reached?: Partial<Record<LeadStage, string>>;
  /** Days to install the accepted bundle. Null before a quote is accepted. */
  installDays?: number | null;
}

export interface TrackerInput {
  lead: TrackerLead | null;
  /** True while the bot still has a question to ask on this lead. */
  hasNextQuestion: boolean;
  latestKyc: { decision: Decision; findings: { severity: string; message: string }[]; checkedAt?: string } | null;
  now?: Date;
}

export const STEPS: readonly { key: StepKey; label: string }[] = [
  { key: 'assess', label: 'Tell us about your business' },
  { key: 'quote', label: 'Review and accept your bundle' },
  { key: 'kyc', label: 'Verify your business' },
  { key: 'activation', label: 'Get connected' },
];

const ORDER: StepKey[] = STEPS.map((s) => s.key);
/** The stage a step reaches when it's finished. */
const STAGE_OF: Record<StepKey, LeadStage> = { assess: 'Needs assessed', quote: 'Quote accepted', kyc: 'KYC complete', activation: 'Activated' };

const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * DAY);

/** When the step in progress is due, or null when it's waiting on the customer. */
function dueDate(step: StepKey, lead: TrackerLead | null, latestKyc: TrackerInput['latestKyc']): Date | null {
  if (step === 'kyc' && latestKyc?.decision === 'MANUAL_REVIEW' && latestKyc.checkedAt) return addDays(latestKyc.checkedAt, REVIEW_DAYS);
  const verified = lead?.reached?.['KYC complete'];
  if (step === 'activation' && verified && lead?.installDays) return addDays(verified, lead.installDays);
  return null;
}

function stepsAt(current: StepKey | 'all-done', lead: TrackerLead | null, latestKyc: TrackerInput['latestKyc'], now: Date): TrackerStep[] {
  const at = current === 'all-done' ? ORDER.length : ORDER.indexOf(current);
  const open = lead?.status !== 'closed';
  return STEPS.map((s, i): TrackerStep => {
    const state: StepState = i < at ? 'done' : i === at ? 'current' : 'todo';
    let date: StepDate | null = null;
    const doneAt = lead?.reached?.[STAGE_OF[s.key]];
    if (state === 'done') date = doneAt ? { kind: 'done', at: doneAt } : null;
    else if (open && state === 'current') {
      const due = dueDate(s.key, lead, latestKyc);
      if (due) date = { kind: 'expected', by: due.toISOString(), overdue: now > due };
    } else if (open && s.key === 'activation' && lead?.installDays) date = { kind: 'after', days: lead.installDays };
    return { ...s, state, date };
  });
}

const dueBy = (steps: TrackerStep[], key: StepKey) => {
  const date = steps.find((s) => s.key === key)?.date;
  return date?.kind === 'expected' ? date : null;
};

const botHref = (leadId: string) => `/bot?lead=${encodeURIComponent(leadId)}`;
export const kycHref = (leadId: string) => `/dashboard/kyc?lead=${encodeURIComponent(leadId)}`;

/** Which step the lead is on, from the furthest stage reached. */
function stepOf(lead: TrackerLead, hasNextQuestion: boolean): StepKey | 'all-done' {
  switch (lead.stage) {
    case 'Activated':
      return 'all-done';
    case 'KYC complete':
      return 'activation';
    case 'Quote accepted':
      return 'kyc';
    default:
      return lead.accepted ? 'kyc' : hasNextQuestion ? 'assess' : 'quote';
  }
}

export function buildTracker({ lead, hasNextQuestion, latestKyc, now = new Date() }: TrackerInput): Tracker {
  if (!lead) {
    return {
      steps: stepsAt('assess', null, latestKyc, now),
      escalation: null,
      current: {
        kind: 'start',
        step: 'assess',
        title: 'Find the right bundle for your business',
        body: 'Answer a few quick questions with Accel Bot and we’ll put together a bundle that fits.',
        cta: { label: 'Start with Accel Bot', href: '/bot' },
      },
    };
  }

  const at = stepOf(lead, hasNextQuestion);
  const steps = stepsAt(at, lead, latestKyc, now);
  // Once the quote is accepted, the delays that follow are ours to answer for.
  const escalation =
    lead.status === 'open' && lead.accepted && at !== 'all-done'
      ? { overdue: steps.some((s) => s.date?.kind === 'expected' && s.date.overdue) }
      : null;
  const base = { steps, escalation };

  if (lead.status === 'closed') {
    return {
      ...base,
      current: {
        kind: 'closed',
        step: null,
        title: 'This request was closed',
        body: 'If you still need a connection, you can start a new request with Accel Bot.',
        cta: { label: 'Start a new request', href: '/bot?new=1' },
      },
    };
  }

  switch (at) {
    case 'assess':
      return {
        ...base,
        current: {
          kind: 'questions',
          step: at,
          title: 'Finish telling us about your business',
          body: 'Accel Bot has a few more questions. Your answers so far are saved.',
          cta: { label: 'Continue with Accel Bot', href: botHref(lead.id) },
        },
      };
    case 'quote':
      return {
        ...base,
        current: {
          kind: 'review_quote',
          step: at,
          title: 'Your bundle is ready',
          body: 'Choose any add-ons, check the monthly total, and accept the quote to move on.',
          cta: { label: 'Review your bundle', href: botHref(lead.id) },
        },
      };
    case 'kyc':
      if (latestKyc?.decision === 'MANUAL_REVIEW') {
        const due = dueBy(steps, 'kyc');
        return {
          ...base,
          current: {
            kind: 'kyc_review',
            step: at,
            title: 'Your documents are being reviewed',
            body: due?.overdue
              ? `Our review was due by ${shortDate(new Date(due.by))} and is running late. Sorry. Please escalate and we’ll look into it.`
              : `Our team is checking a few details by hand${due ? ` and will finish by ${shortDate(new Date(due.by))}` : ''}. We’ll update this page when it’s done.`,
            cta: { label: 'See what we’re checking', href: kycHref(lead.id) },
          },
        };
      }
      if (latestKyc?.decision === 'REJECT') {
        return {
          ...base,
          current: {
            kind: 'kyc_retry',
            step: at,
            title: 'We couldn’t verify your business',
            body: 'Please fix the issues below and upload your documents again.',
            cta: { label: 'Upload documents again', href: kycHref(lead.id) },
            reasons: latestKyc.findings.filter((f) => f.severity === 'REJECT').map((f) => f.message),
          },
        };
      }
      return {
        ...base,
        current: {
          kind: 'kyc',
          step: at,
          title: 'Verify your business',
          body: 'Upload your GST or Udyam certificate, an ID for the authorised signatory, and a recent address proof.',
          cta: { label: 'Complete KYC', href: kycHref(lead.id) },
        },
      };
    case 'activation': {
      const due = dueBy(steps, 'activation');
      return {
        ...base,
        current: {
          kind: 'activation',
          step: at,
          title: 'We’re setting up your connection',
          body: !due
            ? 'Your business is verified. Our team will contact you to schedule installation.'
            : due.overdue
              ? `Installation was due by ${shortDate(new Date(due.by))} and we’re running late. Sorry. Please escalate and we’ll look into it.`
              : `Your business is verified. We’ll install your connection by ${shortDate(new Date(due.by))} and call you first to pick a time.`,
        },
      };
    }
    case 'all-done':
      return {
        ...base,
        current: { kind: 'done', step: null, title: 'You’re connected', body: 'Your Accel Business services are active.' },
      };
  }
}
