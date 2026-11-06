import { levRatio } from './fuzzy';
import { normText, squash } from './normalize';
import { stateByName, STATE_NAMES_LONGEST_FIRST } from './states';

export interface ParsedAddress {
  raw: string;
  street: string;
  city: string | null;
  /** Canonical state name when recognised, else the text found in the state position. */
  state: string | null;
  pincode: string | null;
}

/**
 * Split an Indian address of the form "<unit>, <street>, <city>, <state> - <PIN>" from the right.
 * Tolerates a missing "-" or spaces around it ("Maharashtra-411231").
 */
export function parseAddress(raw: string | null | undefined): ParsedAddress | null {
  const text = squash(raw);
  if (!text) return null;

  let rest = text;
  let pincode: string | null = null;
  const pin = rest.match(/[\s,\-–]*(\d{6})\s*$/);
  if (pin) {
    pincode = pin[1];
    rest = rest.slice(0, pin.index).trim();
  }
  rest = rest.replace(/[\s,\-–]+$/, '');

  const parts = rest.split(',').map((p) => p.trim()).filter(Boolean);
  let state: string | null = null;
  const last = parts.at(-1) ?? '';
  const known = stateByName(last);
  if (known) {
    state = known.name;
    parts.pop();
  } else {
    // State glued to the previous part without a comma, e.g. "Nagpur Maharashtra".
    const lastNorm = normText(last);
    const hit = STATE_NAMES_LONGEST_FIRST.find((n) => lastNorm.endsWith(normText(n)));
    if (hit && parts.length) {
      state = hit;
      const cut = last.slice(0, last.length - hit.length).trim();
      if (cut) parts[parts.length - 1] = cut;
      else parts.pop();
    } else if (parts.length >= 3) {
      state = parts.pop() ?? null;
    }
  }
  const city = parts.length >= 2 ? (parts.pop() ?? null) : null;
  return { raw: text, street: parts.join(', '), city, state, pincode };
}

export const normCity = (s: string | null | undefined) => normText(s).replace(/\s+/g, '');

export interface AddressComparison {
  match: boolean;
  /** Which parts differ: 'pincode' | 'city' | 'state' | 'street'. */
  differences: string[];
  streetScore: number;
}

/**
 * Compare two addresses part by part: PIN code, city and state must be equal, the street part fuzzy
 * (≥ streetMin). Parts missing on either side are not counted as differences.
 */
export function compareAddresses(
  a: ParsedAddress | null,
  b: ParsedAddress | null,
  streetMin: number,
  opts: { cityOnly?: boolean } = {},
): AddressComparison {
  if (!a || !b) return { match: false, differences: ['unparseable'], streetScore: 0 };
  const differences: string[] = [];
  if (a.city && b.city && normCity(a.city) !== normCity(b.city)) differences.push('city');
  if (opts.cityOnly) return { match: differences.length === 0, differences, streetScore: 0 };

  if (a.pincode && b.pincode && a.pincode !== b.pincode) differences.push('pincode');
  if (a.state && b.state && normText(a.state) !== normText(b.state)) differences.push('state');
  const streetScore = a.street && b.street ? levRatio(normText(a.street), normText(b.street)) : 0;
  if (a.street && b.street && streetScore < streetMin) differences.push('street');
  if (!a.pincode || !b.pincode) {
    if (!differences.includes('pincode') && (a.pincode || b.pincode)) differences.push('pincode');
  }
  return { match: differences.length === 0, differences, streetScore };
}
