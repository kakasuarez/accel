import type { Decision, Finding, Severity } from './types';

const RANK: Record<Severity, number> = { REJECT: 0, REVIEW: 1, INFO: 2 };

/** Any REJECT → REJECT; else any REVIEW → MANUAL_REVIEW; else APPROVE. */
export function decide(findings: Finding[]): Decision {
  if (findings.some((f) => f.severity === 'REJECT')) return 'REJECT';
  if (findings.some((f) => f.severity === 'REVIEW')) return 'MANUAL_REVIEW';
  return 'APPROVE';
}

/** Most severe first; rule order kept within a severity (stable sort). */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
