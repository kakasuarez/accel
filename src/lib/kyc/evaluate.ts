import { resolveConfig, type KycConfig } from './config';
import { decide, sortFindings } from './decision';
import { makeFinding } from './reasons';
import { RULES, type RuleCtx } from './rules';
import type { CheckResult, ExtractedBundle, Finding, GstRegistry, KycResult, MaskedBundle, UdyamRegistry } from './types';
import { maskGstin, maskTail, maskUdyam } from './util/mask';

export interface EvaluateOptions {
  config?: Partial<KycConfig>;
  gstRegistry: GstRegistry;
  udyamRegistry: UdyamRegistry;
  applicantId?: string;
}

/**
 * Run all rules on already-extracted documents and decide. Pure apart from registry reads:
 * no OCR, no I/O, so it can be unit-tested with hand-built bundles.
 */
export function evaluateBundle(bundle: ExtractedBundle, opts: EvaluateOptions): KycResult {
  const config = resolveConfig(opts.config);
  const ctx: RuleCtx = { bundle, config, today: config.today, gstRegistry: opts.gstRegistry, udyamRegistry: opts.udyamRegistry };

  const findings: Finding[] = [];
  const checks: CheckResult[] = [];
  for (const rule of RULES) {
    try {
      const outcome = rule.run(ctx);
      if ('skip' in outcome) {
        checks.push({ ruleId: rule.id, status: 'SKIPPED', skippedBecause: outcome.skip });
        continue;
      }
      findings.push(...outcome);
      checks.push({ ruleId: rule.id, status: outcome.some((f) => f.severity !== 'INFO') ? 'FAIL' : 'PASS' });
    } catch (err) {
      // A crashing rule must never let a case through silently.
      findings.push(makeFinding('INTERNAL_RULE_ERROR', config, { message: `Check "${rule.id}" failed to run: ${(err as Error).message}` }));
      checks.push({ ruleId: rule.id, status: 'FAIL' });
    }
  }

  const sorted = sortFindings(findings);
  return {
    applicantId: opts.applicantId,
    decision: decide(sorted),
    findings: sorted.map(maskFinding),
    checks,
    extracted: maskBundle(bundle),
    evaluatedAt: new Date().toISOString(),
    today: config.today,
  };
}

/** Identifiers that are masked wherever they appear in the result. */
const MASKERS: Record<string, (v: string | null) => string | null> = {
  gstin: maskGstin,
  udyamNumber: maskUdyam,
  idNumber: (v) => maskTail(v, 3),
  accountNo: (v) => maskTail(v, 4),
};

function maskFinding(f: Finding): Finding {
  const m = f.field ? MASKERS[f.field] : undefined;
  if (!m) return f;
  return { ...f, expected: f.expected && (m(f.expected) ?? undefined), actual: f.actual && (m(f.actual) ?? undefined) };
}

/** Values the checks used, with identifiers masked (DPDP data minimisation). Raw OCR text is not returned. */
export function maskBundle(bundle: ExtractedBundle): MaskedBundle {
  const out: MaskedBundle = {};
  for (const d of [bundle.gst, bundle.udyam, bundle.signatory, bundle.addressProof]) {
    if (!d) continue;
    const rec: Record<string, string | null> = {};
    for (const [k, f] of Object.entries(d.fields as unknown as Record<string, { value: string | null }>)) {
      if (k === 'designation') continue; // not used by any check
      const v = f.value ?? null;
      rec[k] = MASKERS[k] ? MASKERS[k](v) : v;
    }
    out[d.slot] = rec;
  }
  return out;
}
