import type { Finding } from '../types';
import { compareAddresses, normCity, parseAddress } from '../util/address';
import { bestOf, businessNameScore, personNameScore } from '../util/fuzzy';
import { normText } from '../util/normalize';
import { stateByName } from '../util/states';
import {
  businessNames,
  finding,
  gstView,
  isProprietorship,
  parseLegalName,
  udyamView,
  usable,
  val,
  type Rule,
} from './context';

/** Rule 7: business name consistent across GST, Udyam and the address proof (rules doc §6). */
export const consistencyName: Rule = {
  id: 'consistency.name',
  run(ctx) {
    const biz = businessNames(ctx);
    if (!biz.length) return { skip: 'no business name available' };
    const min = ctx.config.nameMatchMin;
    const out: Finding[] = [];

    const g = gstView(ctx);
    const u = udyamView(ctx);
    if (g && u?.enterpriseName) {
      const best = bestOf(biz, u.enterpriseName, businessNameScore);
      if (best.score < min) {
        out.push(finding(ctx, 'NAME_MISMATCH_UDYAM', { doc: 'udyam_certificate', expected: biz.join(' / '), actual: u.enterpriseName, score: best.score }));
      }
    }

    const billedTo = val(usable(ctx, 'address_proof')?.fields.billedTo);
    if (billedTo) {
      // A proprietor's bill may be in the owner's own name.
      const owner = g && isProprietorship(g.constitution) ? parseLegalName(g.legalName).owner : null;
      const bizBest = bestOf(biz, billedTo, businessNameScore);
      const ownerScore = owner ? personNameScore(owner, billedTo) : 0;
      const score = Math.max(bizBest.score, ownerScore);
      if (score < min) {
        out.push(
          finding(ctx, 'NAME_MISMATCH_ADDR_PROOF', {
            doc: 'address_proof',
            field: 'billedTo',
            expected: [...biz, owner].filter(Boolean).join(' / '),
            actual: billedTo,
            score,
          }),
        );
      }
    }
    return out;
  },
};

/** Rule 8: state consistent between GST, Udyam and the address proof (exact, after code ↔ name mapping). */
export const consistencyState: Rule = {
  id: 'consistency.state',
  run(ctx) {
    const g = gstView(ctx);
    const u = udyamView(ctx);
    const proofAddr = parseAddress(val(usable(ctx, 'address_proof')?.fields.address));
    const canon = (s: string | null | undefined) => (s ? (stateByName(s)?.name ?? s) : null);
    const gState = canon(g?.state);
    const uState = canon(u?.state);
    const pState = canon(proofAddr?.state);
    if (!gState && !uState) return { skip: 'no business state available' };

    const out: Finding[] = [];
    const differ = (a: string, b: string) => normText(a) !== normText(b);
    if (gState && uState && differ(gState, uState)) {
      out.push(finding(ctx, 'STATE_MISMATCH', { field: 'gst↔udyam', expected: gState, actual: uState }));
    }
    const ref = gState ?? uState!;
    if (pState && differ(ref, pState)) {
      out.push(finding(ctx, 'STATE_MISMATCH', { doc: 'address_proof', field: `${gState ? 'gst' : 'udyam'}↔addressProof`, expected: ref, actual: pState }));
    }
    return out;
  },
};

/** Rule 9: address proof vs principal place of business; GST city vs Udyam city. */
export const consistencyAddress: Rule = {
  id: 'consistency.address',
  run(ctx) {
    const g = gstView(ctx);
    const u = udyamView(ctx);
    const proofRaw = val(usable(ctx, 'address_proof')?.fields.address);
    const out: Finding[] = [];

    if (g?.address?.city && u?.city && normCity(g.address.city) !== normCity(u.city)) {
      out.push(finding(ctx, 'CITY_MISMATCH_UDYAM', { doc: 'udyam_certificate', expected: g.address.city, actual: u.city }));
    }

    if (proofRaw) {
      const proof = parseAddress(proofRaw);
      if (g?.address) {
        const cmp = compareAddresses(proof, g.address, ctx.config.addressStreetMatchMin);
        if (!cmp.match) {
          out.push(
            finding(ctx, 'ADDRESS_MISMATCH_PPOB', {
              doc: 'address_proof',
              field: 'address',
              expected: g.address.raw,
              actual: proofRaw,
              score: cmp.streetScore,
              message: `Address proof differs from the principal place of business (${cmp.differences.join(', ')}).`,
            }),
          );
        }
      } else if (u?.city) {
        const cmp = compareAddresses(proof, { raw: u.city, street: '', city: u.city, state: u.state, pincode: null }, 0, { cityOnly: true });
        if (!cmp.match) {
          out.push(finding(ctx, 'ADDRESS_MISMATCH_PPOB', { doc: 'address_proof', field: 'address', expected: u.city, actual: proofRaw, message: 'Address proof is not in the Udyam-registered city.' }));
        }
      }
    }
    if (!g && !u) return { skip: 'no registered address available' };
    return out;
  },
};

/** Rule 10: for proprietorships, the owner (from the GST legal name) should be the signatory. */
export const consistencyProprietor: Rule = {
  id: 'consistency.proprietor',
  run(ctx) {
    const g = gstView(ctx);
    if (!g) return { skip: 'no GST details (constitution unknown)' };
    if (!isProprietorship(g.constitution)) return { skip: `constitution is ${g.constitution ?? 'unknown'}` };
    const owner = parseLegalName(g.legalName).owner;
    const signatory = val(usable(ctx, 'signatory_id')?.fields.name);
    if (!owner || !signatory) return { skip: 'owner or signatory name not available' };
    const score = personNameScore(owner, signatory);
    return score < ctx.config.nameMatchMin
      ? [finding(ctx, 'PROPRIETOR_NAME_MISMATCH', { doc: 'signatory_id', field: 'name', expected: owner, actual: signatory, score })]
      : [];
  },
};
