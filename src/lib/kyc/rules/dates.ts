import type { DocType, Finding, IsoDate } from '../types';
import { daysBetween, isAfter, isBefore } from '../util/dates';
import { businessNames, finding, usable, val, type Rule } from './context';
import { bestOf, businessNameScore } from '../util/fuzzy';

/** Rule 11: no issue/registration date in the future, address proof ≤ 90 days old, signatory ID not expired. */
export const dates: Rule = {
  id: 'dates',
  run(ctx) {
    const out: Finding[] = [];
    const today = ctx.today;

    // validTill is deliberately excluded: an ID's expiry date is expected to be in the future.
    const issueDates: [DocType, string, IsoDate | null][] = [
      ['gst_certificate', 'dateOfLiability', val(usable(ctx, 'gst_certificate')?.fields.dateOfLiability)],
      ['udyam_certificate', 'dateOfRegistration', val(usable(ctx, 'udyam_certificate')?.fields.dateOfRegistration)],
      ['address_proof', 'documentDate', val(usable(ctx, 'address_proof')?.fields.documentDate)],
    ];
    for (const [doc, field, d] of issueDates) {
      if (d && isAfter(d, today)) out.push(finding(ctx, 'DATE_IN_FUTURE', { doc, field, actual: d, expected: `on or before ${today}` }));
    }

    const proofDate = issueDates[2][2];
    if (proofDate && !isAfter(proofDate, today)) {
      const age = daysBetween(proofDate, today);
      if (age > ctx.config.addrProofMaxAgeDays) {
        out.push(
          finding(ctx, 'ADDR_PROOF_STALE', {
            doc: 'address_proof',
            field: 'documentDate',
            actual: proofDate,
            message: `Address proof is ${age} days old (limit ${ctx.config.addrProofMaxAgeDays}); ask for a recent one.`,
          }),
        );
      }
    }

    const validTill = val(usable(ctx, 'signatory_id')?.fields.validTill);
    if (validTill && isBefore(validTill, today)) {
      out.push(finding(ctx, 'SIGNATORY_ID_EXPIRED', { doc: 'signatory_id', field: 'validTill', actual: validTill }));
    }
    if (!issueDates.some(([, , d]) => d) && !validTill) return { skip: 'no dates read' };
    return out;
  },
};

/** Rule 12: the signatory ID is issued for this business. (A missing name is reported by rule 2.) */
export const signatory: Rule = {
  id: 'signatory',
  run(ctx) {
    const d = usable(ctx, 'signatory_id');
    if (!d) return { skip: 'no readable signatory ID' };
    const forBusiness = val(d.fields.forBusiness);
    const biz = businessNames(ctx);
    if (!forBusiness || !biz.length) return { skip: 'business name not available' };
    const best = bestOf(biz, forBusiness, businessNameScore);
    return best.score < ctx.config.nameMatchMin
      ? [finding(ctx, 'SIGNATORY_BUSINESS_MISMATCH', { doc: 'signatory_id', field: 'forBusiness', expected: biz.join(' / '), actual: forBusiness, score: best.score })]
      : [];
  },
};
