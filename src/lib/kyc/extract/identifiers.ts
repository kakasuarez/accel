import { stateByGstCode, stateByUdyamCode } from '../util/states';

// ------------------------------------------------------------------ GSTIN

/** 2-digit state, PAN (AAAAA9999A with 4th char X per dataset rule D2), entity 1-9/A-Z, 'Z', check char. */
export const GSTIN_REGEX = /^\d{2}[A-Z]{3}X[A-Z]\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Base-36 check character over the first 14 characters (rules doc §4.1). */
export function gstinCheckChar(gstin: string): string | null {
  if (gstin.length < 14) return null;
  let total = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARSET.indexOf(gstin[i]);
    if (v < 0) return null;
    const p = v * (i % 2 === 0 ? 1 : 2);
    total += Math.floor(p / 36) + (p % 36);
  }
  return CHARSET[(36 - (total % 36)) % 36];
}

export type GstinProblem = 'FORMAT' | 'STATE_CODE' | 'CHECKSUM';

export function validateGstin(g: string): GstinProblem | null {
  if (!GSTIN_REGEX.test(g)) return 'FORMAT';
  if (!stateByGstCode(g.slice(0, 2))) return 'STATE_CODE';
  if (gstinCheckChar(g) !== g[14]) return 'CHECKSUM';
  return null;
}

const TO_DIGIT: Record<string, string> = { O: '0', D: '0', Q: '0', I: '1', L: '1', J: '1', Z: '2', S: '5', G: '6', T: '7', B: '8' };
const TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '4': 'A', '5': 'S', '6': 'G', '7': 'T', '8': 'B' };

/** Character class each GSTIN position must have (index 0–14). Index 14 (check char) is never changed. */
const GSTIN_CLASS: ('d' | 'L' | 'any' | 'Z' | 'check')[] = [
  'd', 'd', 'L', 'L', 'L', 'L', 'L', 'd', 'd', 'd', 'd', 'L', 'any', 'Z', 'check',
];

export interface Repaired {
  value: string;
  repaired: boolean;
}

/**
 * Groups of characters that OCR engines commonly confuse in upper-case alphanumeric codes (the usual
 * confusion sets used for licence-plate, MRZ and serial-number post-correction). They are generic, not
 * tuned to the sample images. Every member of a group is a candidate for every other member.
 */
const CONFUSION_GROUPS = ['O0DQ', 'I1LJT', '7T', 'S5', 'B8', 'Z2', 'G6C', 'MN', 'UV', 'EF', 'KX', 'A4', 'PR'];
const LOOKALIKES: Record<string, string[]> = {};
for (const g of CONFUSION_GROUPS) {
  for (const c of g) LOOKALIKES[c] = [...new Set([...(LOOKALIKES[c] ?? []), ...g.replace(c, '')])];
}
const confusable = (a: string, b: string) => a === b || (LOOKALIKES[a] ?? []).includes(b);

/** Map each position to its required class (digit/letter/'Z'); the check character is left as read. */
function classRepair15(s: string): string {
  const out = s.split('');
  for (let i = 0; i < 14; i++) {
    const cls = GSTIN_CLASS[i];
    const c = out[i];
    if (cls === 'd' && !/\d/.test(c) && TO_DIGIT[c]) out[i] = TO_DIGIT[c];
    else if (cls === 'L' && /\d/.test(c) && TO_LETTER[c]) out[i] = TO_LETTER[c];
    else if (cls === 'Z' && c !== 'Z' && /[27]/.test(c)) out[i] = 'Z';
  }
  return out.join('');
}

/**
 * Deterministic, position-aware repair of an OCR'd GSTIN (the technique MRZ/ID-card parsers use):
 *  - a digit where a letter must be (or the reverse) is mapped to its look-alike, and position 14 is forced to 'Z';
 *  - one extra character from a split glyph (a slashed zero read as "0O") is dropped, only when exactly one
 *    such deletion gives a fully valid GSTIN (format + check digit).
 * The check character is never changed.
 */
export function repairGstin(raw: string | null | undefined): Repaired | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (s.length === 15) {
    const value = classRepair15(s);
    return { value, repaired: value !== raw };
  }
  if (s.length === 16) {
    const valid = new Set<string>();
    for (let i = 0; i < 15; i++) {
      if (!confusable(s[i], s[i + 1])) continue;
      for (const drop of [i, i + 1]) {
        const cand = classRepair15(s.slice(0, drop) + s.slice(drop + 1));
        if (validateGstin(cand) === null) valid.add(cand);
      }
    }
    if (valid.size === 1) return { value: [...valid][0], repaired: true };
  }
  return { value: s, repaired: s !== raw };
}

/**
 * GSTINs one look-alike substitution away (positions 0–13 only; the check character is never changed)
 * that are well-formed and pass the checksum. Used only to resolve an OCR misread against the registry:
 * a candidate is accepted only if it is also an exact registry key.
 */
export function gstinLookalikeCandidates(g: string): string[] {
  if (g.length !== 15) return [];
  const out: string[] = [];
  for (let i = 0; i < 14; i++) {
    for (const alt of LOOKALIKES[g[i]] ?? []) {
      const cand = g.slice(0, i) + alt + g.slice(i + 1);
      if (validateGstin(cand) === null) out.push(cand);
    }
  }
  return out;
}

// ------------------------------------------------------------------ Udyam

export const UDYAM_REGEX = /^UDYAM-[A-Z]{2}-00-\d{7}$/;

export type UdyamProblem = 'FORMAT' | 'STATE_CODE';

export function validateUdyam(u: string): UdyamProblem | null {
  if (!UDYAM_REGEX.test(u)) return 'FORMAT';
  if (!stateByUdyamCode(u.slice(6, 8))) return 'STATE_CODE';
  return null;
}

/** Normalize separators and fix digit/letter look-alikes in each segment of UDYAM-XX-00-0000000. */
export function repairUdyam(raw: string | null | undefined): Repaired | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[\s–—_]+/g, '-').replace(/-+/g, '-').replace(/[^0-9A-Z-]/g, '');
  const m = s.match(/^(UDYAM|UDYAN|UOYAM|UDVAM)-?([A-Z0-9]{2})-?([A-Z0-9]{2})-?([A-Z0-9]{7})$/);
  if (!m) return { value: s, repaired: s !== raw };
  const letters = m[2].split('').map((c) => (/\d/.test(c) ? (TO_LETTER[c] ?? c) : c)).join('');
  const digits = (x: string) => x.split('').map((c) => (/\d/.test(c) ? c : (TO_DIGIT[c] ?? c))).join('');
  const value = `UDYAM-${letters}-${digits(m[3])}-${digits(m[4])}`;
  return { value, repaired: value !== raw };
}
