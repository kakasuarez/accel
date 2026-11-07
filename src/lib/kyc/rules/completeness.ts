import type { DocType, Finding } from '../types';
import { DOC_TYPES } from '../types';
import { docIn, finding, submitted, usable, val, type Rule, type RuleCtx } from './context';

/** Rule 1: required documents present, readable and of the right type (rules doc §2). */
export const completeness: Rule = {
  id: 'completeness',
  run(ctx) {
    const out: Finding[] = [];
    for (const slot of DOC_TYPES) {
      const d = docIn(ctx.bundle, slot);
      if (!d) continue;
      if (d.detectedType !== slot && d.detectedType !== 'unknown') {
        out.push(finding(ctx, 'DOC_TYPE_MISMATCH', { doc: slot, expected: slot, actual: d.detectedType }));
      } else if (!d.readable) {
        out.push(finding(ctx, 'DOC_UNREADABLE', { doc: slot }));
      }
    }
    if (!submitted(ctx, 'signatory_id')) out.push(finding(ctx, 'DOC_MISSING_SIGNATORY_ID', { doc: 'signatory_id' }));
    if (!submitted(ctx, 'address_proof')) out.push(finding(ctx, 'DOC_MISSING_ADDRESS_PROOF', { doc: 'address_proof' }));

    const gst = submitted(ctx, 'gst_certificate');
    const udyam = submitted(ctx, 'udyam_certificate');
    if (!gst && ctx.requireGst) out.push(finding(ctx, 'GST_REQUIRED', { doc: 'gst_certificate' }));
    else if (!gst && !udyam) out.push(finding(ctx, 'NO_BUSINESS_PROOF'));
    else if (gst && !udyam) out.push(finding(ctx, 'UDYAM_ABSENT', { doc: 'udyam_certificate' }));
    else if (!gst && udyam) out.push(finding(ctx, 'GST_ABSENT_PAN_UNVERIFIABLE', { doc: 'gst_certificate' }));
    return out;
  },
};

/** Required fields per document (LLD §8a). Identifier fields get their own codes. */
const REQUIRED: { [K in DocType]: { field: string; code?: 'GSTIN_MISSING' | 'UDYAM_NUMBER_MISSING' | 'SIGNATORY_NAME_MISSING' }[] } = {
  gst_certificate: [
    { field: 'gstin', code: 'GSTIN_MISSING' },
    { field: 'legalName' },
    { field: 'tradeName' },
    { field: 'address' },
    { field: 'dateOfLiability' },
  ],
  udyam_certificate: [
    { field: 'udyamNumber', code: 'UDYAM_NUMBER_MISSING' },
    { field: 'enterpriseName' },
    { field: 'city' },
    { field: 'state' },
    { field: 'dateOfRegistration' },
  ],
  signatory_id: [{ field: 'name', code: 'SIGNATORY_NAME_MISSING' }, { field: 'forBusiness' }, { field: 'validTill' }],
  address_proof: [{ field: 'billedTo' }, { field: 'address' }, { field: 'documentDate' }],
};

/** Date fields whose value drives a reject/review decision; a low-confidence read is flagged. */
const DECISION_DATES: Partial<Record<DocType, string>> = {
  address_proof: 'documentDate',
  signatory_id: 'validTill',
};

/** Rule 2: required fields present (and decision-critical dates read with reasonable confidence). */
export const fieldsPresent: Rule = {
  id: 'fields.present',
  run(ctx: RuleCtx) {
    const out: Finding[] = [];
    for (const slot of DOC_TYPES) {
      const d = usable(ctx, slot);
      if (!d) continue;
      const fields = d.fields as unknown as Record<string, { value: unknown; raw: string | null; confidence: number }>;
      for (const req of REQUIRED[slot]) {
        const f = fields[req.field];
        if (val(f as never) == null) {
          out.push(
            finding(ctx, req.code ?? 'FIELD_MISSING', {
              doc: slot,
              field: req.field,
              actual: f?.raw ?? null,
              message: f?.raw ? `"${req.field}" could not be read as a valid value.` : undefined,
            }),
          );
        }
      }
      const dateField = DECISION_DATES[slot];
      const df = dateField ? fields[dateField] : undefined;
      if (dateField && df?.value != null && df.confidence < ctx.config.ocrLowConfidence) {
        out.push(finding(ctx, 'LOW_OCR_CONFIDENCE', { doc: slot, field: dateField, score: df.confidence / 100 }));
      }
    }
    return out;
  },
};
