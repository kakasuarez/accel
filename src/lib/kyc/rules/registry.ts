import type { Finding } from '../types';
import { compareAddresses, normCity, parseAddress } from '../util/address';
import { levRatio } from '../util/fuzzy';
import { normName, normText } from '../util/normalize';
import { stateByGstCode, stateByName, stateByUdyamCode } from '../util/states';
import { docIn, finding, submitted, usable, val, type Rule, type RuleCtx } from './context';

/** Strict similarity for certificate-vs-registry text (tamper signal): edit ratio on normalized names. */
const strictScore = (a: string, b: string) => levRatio(normName(a), normName(b));

/** Explains a failed verification when the identifier was read, but with low OCR confidence. */
function lowConfidenceNote(ctx: RuleCtx, doc: 'gst_certificate' | 'udyam_certificate', field: 'gstin' | 'udyamNumber'): Finding[] {
  const fields = docIn(ctx.bundle, doc)?.fields as Record<string, { raw: string | null; confidence: number }> | undefined;
  const f = fields?.[field];
  return f?.raw && f.confidence < ctx.config.ocrLowConfidence
    ? [finding(ctx, 'LOW_OCR_CONFIDENCE', { doc, field, score: f.confidence / 100 })]
    : [];
}

/**
 * Rule 5: GST verification against the government source (mandatory gate, LLD §8c).
 * Never skipped when a GST certificate was submitted: if the GSTIN can't be looked up, the case is rejected.
 */
export const registryGst: Rule = {
  id: 'registry.gst',
  run(ctx) {
    if (!submitted(ctx, 'gst_certificate')) return { skip: 'no GST certificate submitted' };
    const doc = 'gst_certificate' as const;
    const d = usable(ctx, doc);

    if (!ctx.gstin) {
      return [
        finding(ctx, 'GST_NOT_VERIFIED', {
          doc,
          message: !d
            ? 'GST certificate is unreadable, so it could not be verified against the GST registry.'
            : 'GSTIN is missing or invalid, so the GST certificate could not be verified against the GST registry.',
        }),
        ...lowConfidenceNote(ctx, doc, 'gstin'),
      ];
    }

    const rec = ctx.gstRegistry.get(ctx.gstin);
    if (!rec) return [finding(ctx, 'GSTIN_NOT_FOUND', { doc, field: 'gstin', actual: ctx.gstin }), ...lowConfidenceNote(ctx, doc, 'gstin')];
    ctx.gstRec = rec;

    const out: Finding[] = [];
    const status = rec.status.trim().toLowerCase();
    if (status === 'cancelled') out.push(finding(ctx, 'GST_STATUS_CANCELLED', { doc, actual: rec.status }));
    else if (status === 'suspended') out.push(finding(ctx, 'GST_STATUS_SUSPENDED', { doc, actual: rec.status }));
    else if (status !== 'active') out.push(finding(ctx, 'GST_STATUS_UNKNOWN', { doc, actual: rec.status }));

    // GSTIN state code vs the registry's state column.
    const codeState = stateByGstCode(ctx.gstin.slice(0, 2))?.name;
    if (codeState && stateByName(rec.state)?.name !== codeState) {
      out.push(finding(ctx, 'STATE_MISMATCH', { doc, field: 'gstin↔gstRegistry.state', expected: rec.state, actual: codeState }));
    }

    // Certificate values vs the registry record (only fields that were read; missing ones are reported by rule 2).
    if (d) {
      const f = d.fields;
      const min = ctx.config.registryFieldMatchMin;
      const mismatch = (field: string, expected: string, actual: string, score?: number) =>
        out.push(finding(ctx, 'GST_CERT_MISMATCH', { doc, field, expected, actual, score }));

      for (const [field, cert, reg] of [
        ['legalName', val(f.legalName), rec.legalName],
        ['tradeName', val(f.tradeName), rec.tradeName],
      ] as const) {
        if (!cert) continue;
        const s = strictScore(cert, reg);
        if (s < min) mismatch(field, reg, cert, s);
      }
      const constitution = val(f.constitution);
      if (constitution && normText(constitution) !== normText(rec.constitution)) mismatch('constitution', rec.constitution, constitution);

      const addr = val(f.address);
      if (addr) {
        const cmp = compareAddresses(parseAddress(addr), parseAddress(rec.principalPlaceOfBusiness), ctx.config.addressStreetMatchMin);
        if (!cmp.match) mismatch('address', rec.principalPlaceOfBusiness, addr, cmp.streetScore);
      }
      const dol = val(f.dateOfLiability);
      if (dol && dol !== rec.registrationDate) mismatch('registrationDate', rec.registrationDate, dol);
    }
    return out;
  },
};

/**
 * Rule 6: Udyam verification against the government source (mandatory gate, LLD §8c).
 *
 * Certificate vs registry: the Udyam portal is authoritative and an enterprise can update some details
 * after its certificate was printed. Differences in major activity and date of registration are reported
 * as information (the registry value is used); differences in the fields that identify the business
 * (name, city, state) are sent to review.
 */
export const registryUdyam: Rule = {
  id: 'registry.udyam',
  run(ctx) {
    if (!submitted(ctx, 'udyam_certificate')) return { skip: 'no Udyam certificate submitted' };
    const doc = 'udyam_certificate' as const;
    const d = usable(ctx, doc);

    if (!ctx.udyamNumber) {
      return [
        finding(ctx, 'UDYAM_NOT_VERIFIED', {
          doc,
          message: !d
            ? 'Udyam certificate is unreadable, so it could not be verified against the Udyam registry.'
            : 'Udyam number is missing or invalid, so the Udyam certificate could not be verified against the Udyam registry.',
        }),
        ...lowConfidenceNote(ctx, doc, 'udyamNumber'),
      ];
    }

    const rec = ctx.udyamRegistry.get(ctx.udyamNumber);
    if (!rec) return [finding(ctx, 'UDYAM_NOT_FOUND', { doc, field: 'udyamNumber', actual: ctx.udyamNumber }), ...lowConfidenceNote(ctx, doc, 'udyamNumber')];
    ctx.udyamRec = rec;

    const out: Finding[] = [];
    const codeState = stateByUdyamCode(ctx.udyamNumber.slice(6, 8))?.name;
    if (codeState && stateByName(rec.state)?.name !== codeState) {
      out.push(finding(ctx, 'STATE_MISMATCH', { doc, field: 'udyamNumber↔udyamRegistry.state', expected: rec.state, actual: codeState }));
    }

    if (d) {
      const f = d.fields;
      const mismatch = (field: string, expected: string, actual: string, score?: number) =>
        out.push(finding(ctx, 'UDYAM_CERT_MISMATCH', { doc, field, expected, actual, score }));

      const name = val(f.enterpriseName);
      if (name) {
        const s = strictScore(name, rec.enterpriseName);
        if (s < ctx.config.registryFieldMatchMin) mismatch('enterpriseName', rec.enterpriseName, name, s);
      }
      const city = val(f.city);
      if (city && normCity(city) !== normCity(rec.city)) mismatch('city', rec.city, city);
      const state = val(f.state);
      if (state && normText(state) !== normText(rec.state)) mismatch('state', rec.state, state);
      const act = val(f.majorActivity);
      if (act && normText(act) !== normText(rec.majorActivity)) {
        // Activity can be edited on the portal after printing; the registry value is used downstream.
        out.push(finding(ctx, 'UDYAM_ACTIVITY_UPDATED', { doc, field: 'majorActivity', expected: rec.majorActivity, actual: act }));
      }
      const dor = val(f.dateOfRegistration);
      if (dor && dor !== rec.dateOfRegistration) {
        // Informational by product decision: the Udyam number itself was verified, and the registry date is used.
        // Raise severity via config.severityOverrides.UDYAM_REG_DATE_DIFFERS if this should block approval.
        out.push(finding(ctx, 'UDYAM_REG_DATE_DIFFERS', { doc, field: 'dateOfRegistration', expected: rec.dateOfRegistration, actual: dor }));
      }
    }
    return out;
  },
};
