import { differenceInCalendarDays, format, isValid, parse } from 'date-fns';
import type { IsoDate } from '../types';

/** Date layouts commonly printed on Indian certificates and bills (date-fns tokens). */
const DOC_DATE_FORMATS = [
  'yyyy-MM-dd',
  'dd/MM/yyyy',
  'dd-MM-yyyy',
  'dd.MM.yyyy',
  'd/M/yyyy',
  'd-M-yyyy',
  'dd-MMM-yyyy',
  'dd MMM yyyy',
  'd MMM yyyy',
  'dd MMMM yyyy',
  'd MMMM yyyy',
  'MMM d, yyyy',
  'MMMM d, yyyy',
];

const REF = new Date(2000, 0, 1);

/** OCR look-alikes inside an otherwise numeric date ("2O25-O6-07" → "2025-06-07"). Only applied when no month name is present. */
function fixDigitLookalikes(s: string): string {
  if (/[a-z]{3,}/i.test(s.replace(/[OoIlSB]/g, ''))) return s;
  return s.replace(/[OoDQ]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
}

/**
 * Parse a date as printed on a document into 'YYYY-MM-DD'. Tries the formats in DOC_DATE_FORMATS with
 * date-fns (strict: the whole string must match and the date must exist). Returns null otherwise.
 */
export function parseDocDate(raw: string | null | undefined): IsoDate | null {
  if (!raw) return null;
  const candidates = new Set([raw.trim().replace(/\s+/g, ' '), fixDigitLookalikes(raw.trim().replace(/\s+/g, ' '))]);
  for (const s of candidates) {
    for (const f of DOC_DATE_FORMATS) {
      const d = parse(s, f, REF);
      if (isValid(d) && d.getFullYear() >= 1900 && d.getFullYear() <= 2100) return format(d, 'yyyy-MM-dd');
    }
  }
  return null;
}

/** Regex that finds date-looking substrings in free text (used by the whole-page fallback scan). */
export const DATE_LIKE = /\b(\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}[-./]\d{1,2}[-./]\d{4}|\d{1,2}[ -][A-Za-z]{3,9}[ -,]+\d{4})\b/g;

const asDate = (d: IsoDate) => parse(d, 'yyyy-MM-dd', REF);

/** Calendar days from a to b (positive when b is later). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return differenceInCalendarDays(asDate(b), asDate(a));
}

/** ISO dates compare correctly as strings. */
export const isAfter = (a: IsoDate, b: IsoDate) => a > b;
export const isBefore = (a: IsoDate, b: IsoDate) => a < b;
