import { distance } from 'fastest-levenshtein';
import { normBusinessName, normName } from './normalize';

/** 1 − editDistance / maxLength, in [0, 1]. Two empty strings score 0 (nothing to compare). */
export function levRatio(a: string, b: string): number {
  if (!a && !b) return 0;
  const max = Math.max(a.length, b.length);
  return 1 - distance(a, b) / max;
}

const sortTokens = (s: string) => s.split(' ').filter(Boolean).sort().join(' ');

/** Similarity of two already-normalized strings: best of plain and token-sorted edit ratio. */
function score(a: string, b: string): number {
  if (!a || !b) return 0;
  return Math.max(levRatio(a, b), levRatio(sortTokens(a), sortTokens(b)));
}

/** Person-name similarity (case, punctuation and word order ignored). */
export function personNameScore(a: string | null | undefined, b: string | null | undefined): number {
  return score(normName(a), normName(b));
}

/**
 * Business-name similarity: "Pvt Ltd" = "Private Limited", "&" = "and", punctuation and case ignored,
 * and legal-form words (Private Limited, LLP, …) dropped so "X Pvt Ltd" matches "X".
 */
export function businessNameScore(a: string | null | undefined, b: string | null | undefined): number {
  return score(normBusinessName(a), normBusinessName(b));
}

/** Best score of `x` against several candidates, with the candidate that produced it. */
export function bestOf(
  candidates: (string | null | undefined)[],
  x: string | null | undefined,
  scorer: (a: string | null | undefined, b: string | null | undefined) => number = businessNameScore,
): { score: number; candidate: string | null } {
  let best = { score: 0, candidate: null as string | null };
  for (const c of candidates) {
    if (!c) continue;
    const s = scorer(c, x);
    if (s > best.score) best = { score: s, candidate: c };
  }
  return best;
}
