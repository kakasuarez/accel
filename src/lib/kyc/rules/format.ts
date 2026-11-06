import { gstinLookalikeCandidates, validateGstin, validateUdyam } from '../extract/identifiers';
import type { Finding } from '../types';
import { finding, usable, val, type Rule } from './context';

/**
 * Rule 3: GSTIN structure, state code and check digit (rules doc §4.1).
 *
 * If the checksum fails, the OCR text may hold a single look-alike misread (e.g. "I" for "J"). Each
 * one-character look-alike variant that is well-formed and passes the checksum is tried against the
 * registry; exactly one exact registry hit is accepted (and reported as OCR_CORRECTED). Otherwise the
 * checksum failure stands. The check character itself is never altered.
 */
export const formatGstin: Rule = {
  id: 'format.gstin',
  run(ctx) {
    const d = usable(ctx, 'gst_certificate');
    if (!d) return { skip: 'no readable GST certificate' };
    const field = d.fields.gstin;
    const g = val(field);
    if (!g) return { skip: 'GSTIN not read' };

    const out: Finding[] = [];
    const problem = validateGstin(g);
    if (problem === null) {
      ctx.gstin = g;
      if (field.repaired) out.push(finding(ctx, 'OCR_CORRECTED', { doc: 'gst_certificate', field: 'gstin', expected: g, actual: field.raw }));
      return out;
    }
    if (problem === 'CHECKSUM') {
      const hits = gstinLookalikeCandidates(g).filter((c) => ctx.gstRegistry.get(c));
      if (hits.length === 1) {
        ctx.gstin = hits[0];
        out.push(
          finding(ctx, 'OCR_CORRECTED', {
            doc: 'gst_certificate',
            field: 'gstin',
            expected: hits[0],
            actual: field.raw,
            message: 'GSTIN read with one look-alike character; the corrected value passes the checksum and is in the GST registry.',
          }),
        );
        return out;
      }
    }
    const code = problem === 'FORMAT' ? 'GSTIN_FORMAT_INVALID' : problem === 'STATE_CODE' ? 'GSTIN_STATE_CODE_INVALID' : 'GSTIN_CHECKSUM_INVALID';
    out.push(finding(ctx, code, { doc: 'gst_certificate', field: 'gstin', actual: g }));
    return out;
  },
};

/** Rule 4: Udyam number structure UDYAM-XX-00-0000000 with a known state code (rules doc §4.2). */
export const formatUdyam: Rule = {
  id: 'format.udyam',
  run(ctx) {
    const d = usable(ctx, 'udyam_certificate');
    if (!d) return { skip: 'no readable Udyam certificate' };
    const field = d.fields.udyamNumber;
    const u = val(field);
    if (!u) return { skip: 'Udyam number not read' };
    const problem = validateUdyam(u);
    if (problem) {
      return [
        finding(ctx, 'UDYAM_FORMAT_INVALID', {
          doc: 'udyam_certificate',
          field: 'udyamNumber',
          actual: u,
          message: problem === 'STATE_CODE' ? 'Udyam number has an unknown state code.' : undefined,
        }),
      ];
    }
    ctx.udyamNumber = u;
    return field.repaired ? [finding(ctx, 'OCR_CORRECTED', { doc: 'udyam_certificate', field: 'udyamNumber', expected: u, actual: field.raw })] : [];
  },
};
