import type { LeadStage } from '../leads/stages';
import type { Decision } from '../kyc/types';

/**
 * The dashboard's "what next" tracker. Pure: it only reads the lead's state, so it can run on the server
 * page and in tests. Every step is derived from data the backend already keeps (stage, quote, next question,
 * latest KYC attempt); nothing is stored for the tracker itself.
 */

export type StepKey = 'assess' | 'quote' | 'kyc' | 'activation';
export type StepState = 'done' | 'current' | 'todo';

export interface TrackerStep {
  key: StepKey;
  label: string;
  state: StepState;
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
}

export interface TrackerLead {
  id: string;
  stage: LeadStage | null;
  status: 'open' | 'closed';
  /** True once the customer has accepted a quote. */
  accepted: boolean;
}

export interface TrackerInput {
  lead: TrackerLead | null;
  /** True while the bot still has a question to ask on this lead. */
  hasNextQuestion: boolean;
  latestKyc: { decision: Decision; findings: { severity: string; message: string }[] } | null;
}

export const STEPS: readonly { key: StepKey; label: string }[] = [
  { key: 'assess', label: 'Tell us about your business' },
  { key: 'quote', label: 'Review and accept your bundle' },
  { key: 'kyc', label: 'Verify your business' },
  { key: 'activation', label: 'Get connected' },
];

const ORDER: StepKey[] = STEPS.map((s) => s.key);

function stepsAt(current: StepKey | 'all-done'): TrackerStep[] {
  const at = current === 'all-done' ? ORDER.length : ORDER.indexOf(current);
  return STEPS.map((s, i) => ({ ...s, state: i < at ? 'done' : i === at ? 'current' : 'todo' }));
}

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

export function buildTracker({ lead, hasNextQuestion, latestKyc }: TrackerInput): Tracker {
  if (!lead) {
    return {
      steps: stepsAt('assess'),
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
  const steps = stepsAt(at);

  if (lead.status === 'closed') {
    return {
      steps,
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
        steps,
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
        steps,
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
        return {
          steps,
          current: {
            kind: 'kyc_review',
            step: at,
            title: 'Your documents are being reviewed',
            body: 'Our team is checking a few details by hand. We’ll update this page when it’s done.',
            cta: { label: 'See what we’re checking', href: kycHref(lead.id) },
          },
        };
      }
      if (latestKyc?.decision === 'REJECT') {
        return {
          steps,
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
        steps,
        current: {
          kind: 'kyc',
          step: at,
          title: 'Verify your business',
          body: 'Upload your GST or Udyam certificate, an ID for the authorised signatory, and a recent address proof.',
          cta: { label: 'Complete KYC', href: kycHref(lead.id) },
        },
      };
    case 'activation':
      return {
        steps,
        current: {
          kind: 'activation',
          step: at,
          title: 'We’re setting up your connection',
          body: 'Your business is verified. Our team will contact you to schedule installation.',
        },
      };
    case 'all-done':
      return {
        steps,
        current: { kind: 'done', step: null, title: 'You’re connected', body: 'Your Accel Business services are active.' },
      };
  }
}
