import 'server-only';
import type postgres from 'postgres';
import { db } from '../db';
import type { Decision, Finding } from './types';

/** What the customer sees about a KYC attempt. Findings are already masked by the engine. */
export interface KycCheck {
  decision: Decision;
  findings: Pick<Finding, 'code' | 'severity' | 'doc' | 'message'>[];
  checkedAt: string;
}

interface KycCheckRow {
  decision: Decision;
  findings: KycCheck['findings'];
  created_at: string;
}

const toCheck = (row: KycCheckRow): KycCheck => ({ decision: row.decision, findings: row.findings, checkedAt: row.created_at });

/**
 * Keeps only code, severity, document and message. `expected` / `actual` can hold values read from the
 * documents, so they are dropped rather than stored (DPDP: keep only what the customer needs to fix it).
 */
export const publicFindings = (findings: readonly Finding[]): KycCheck['findings'] =>
  findings.map(({ code, severity, doc, message }) => ({ code, severity, ...(doc ? { doc } : {}), message }));

export async function saveKycCheck(leadId: string, userId: string, decision: Decision, findings: readonly Finding[]): Promise<KycCheck> {
  const [row] = await db()<KycCheckRow[]>`
    insert into kyc_checks (lead_id, user_id, decision, findings)
    values (${leadId}, ${userId}, ${decision}, ${db().json(publicFindings(findings) as unknown as postgres.JSONValue)})
    returning decision, findings, created_at`;
  return toCheck(row!);
}

export async function latestKycCheck(leadId: string): Promise<KycCheck | null> {
  const [row] = await db()<KycCheckRow[]>`
    select decision, findings, created_at from kyc_checks where lead_id = ${leadId} order by created_at desc, id desc limit 1`;
  return row ? toCheck(row) : null;
}

/** A new attempt is allowed only before the first one or after a rejection; a manual review must finish first. */
export const canSubmitKyc = (latest: KycCheck | null): boolean => !latest || latest.decision === 'REJECT';
