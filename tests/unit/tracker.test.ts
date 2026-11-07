import { describe, expect, it } from 'vitest';
import { buildTracker, type TrackerInput, type TrackerLead } from '@/lib/dashboard/tracker';

const lead = (over: Partial<TrackerLead> = {}): TrackerLead => ({ id: 'L1', stage: null, status: 'open', accepted: false, ...over });
const run = (over: Partial<TrackerInput>) => buildTracker({ lead: lead(), hasNextQuestion: false, latestKyc: null, ...over });
const states = (t: ReturnType<typeof buildTracker>) => t.steps.map((s) => s.state);

describe('dashboard tracker', () => {
  it('starts with the bot when there is no lead', () => {
    const t = run({ lead: null });
    expect(t.current.kind).toBe('start');
    expect(t.current.cta?.href).toBe('/bot');
    expect(states(t)).toEqual(['current', 'todo', 'todo', 'todo']);
  });

  it('continues the questions while the bot has one to ask', () => {
    const t = run({ hasNextQuestion: true });
    expect(t.current.kind).toBe('questions');
    expect(t.current.cta?.href).toBe('/bot?lead=L1');
  });

  it('keeps asking add-on questions after the needs are assessed', () => {
    expect(run({ lead: lead({ stage: 'Needs assessed' }), hasNextQuestion: true }).current.kind).toBe('questions');
  });

  it('asks to review the quote once the questions are done', () => {
    const t = run({ lead: lead({ stage: 'Needs assessed' }) });
    expect(t.current.kind).toBe('review_quote');
    expect(states(t)).toEqual(['done', 'current', 'todo', 'todo']);
  });

  it('opens KYC after the quote is accepted', () => {
    const t = run({ lead: lead({ stage: 'Quote accepted', accepted: true }) });
    expect(t.current.kind).toBe('kyc');
    expect(t.current.cta?.href).toBe('/dashboard/kyc?lead=L1');
    expect(states(t)).toEqual(['done', 'done', 'current', 'todo']);
  });

  it('links to the review details while documents are in manual review', () => {
    const t = run({ lead: lead({ stage: 'Quote accepted', accepted: true }), latestKyc: { decision: 'MANUAL_REVIEW', findings: [] } });
    expect(t.current.kind).toBe('kyc_review');
    expect(t.current.cta?.href).toBe('/dashboard/kyc?lead=L1');
  });

  it('shows the rejection reasons and lets the customer upload again', () => {
    const t = run({
      lead: lead({ stage: 'Quote accepted', accepted: true }),
      latestKyc: {
        decision: 'REJECT',
        findings: [
          { severity: 'REJECT', message: 'GSTIN not found in the GST registry.' },
          { severity: 'INFO', message: 'note' },
        ],
      },
    });
    expect(t.current.kind).toBe('kyc_retry');
    expect(t.current.reasons).toEqual(['GSTIN not found in the GST registry.']);
    expect(t.current.cta?.href).toBe('/dashboard/kyc?lead=L1');
  });

  it('moves to activation after KYC, then done', () => {
    expect(run({ lead: lead({ stage: 'KYC complete', accepted: true }) }).current.kind).toBe('activation');
    const done = run({ lead: lead({ stage: 'Activated', accepted: true }) });
    expect(done.current.kind).toBe('done');
    expect(states(done)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('says a closed request is closed, whatever its stage', () => {
    const t = run({ lead: lead({ stage: 'Quote accepted', accepted: true, status: 'closed' }) });
    expect(t.current.kind).toBe('closed');
    expect(t.current.cta?.href).toBe('/bot?new=1');
  });
});
