/** Lowercase, "&" → "and", punctuation → space, whitespace collapsed. */
export function normText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const TOKEN_EXPANSIONS: Record<string, string> = {
  pvt: 'private',
  ltd: 'limited',
  co: 'company',
  corp: 'corporation',
  intl: 'international',
};

/** Legal-form tokens dropped when comparing business names ("Pvt Ltd" vs "Private Limited" vs nothing). */
const LEGAL_FORM_TOKENS = new Set(['private', 'limited', 'llp', 'company', 'opc', 'ms']);

/** Normalized name with abbreviations expanded: "Trinity Bake House Pvt. Ltd." → "trinity bake house private limited". */
export function normName(s: string | null | undefined): string {
  return normText(s)
    .split(' ')
    .filter(Boolean)
    .map((t) => TOKEN_EXPANSIONS[t] ?? t)
    .join(' ');
}

/** Business name for comparison: normalized, legal-form words removed. Falls back to normName if nothing remains. */
export function normBusinessName(s: string | null | undefined): string {
  const n = normName(s);
  const core = n
    .split(' ')
    .filter((t) => !LEGAL_FORM_TOKENS.has(t))
    .join(' ');
  return core || n;
}

/** Collapse internal whitespace and trim. */
export function squash(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}
