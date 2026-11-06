import type { FieldSpec } from '../extract/labels';
import { levRatio } from '../util/fuzzy';
import { normText } from '../util/normalize';

export interface OcrWord {
  text: string;
  conf: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A run of words on one visual row with no large horizontal gap (e.g. a label, or a value). */
export interface Segment {
  text: string;
  words: OcrWord[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Row {
  y0: number;
  y1: number;
  segments: Segment[];
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * Group words into rows (by vertical centre) and split each row into segments at large horizontal gaps.
 * All thresholds are relative to the median word height, so they scale with resolution.
 */
export function buildRows(words: OcrWord[]): { rows: Row[]; lineHeight: number } {
  const ws = words.filter((w) => w.text.trim());
  const h = median(ws.map((w) => w.y1 - w.y0)) || 1;
  const sorted = [...ws].sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);

  const rowsOfWords: OcrWord[][] = [];
  for (const w of sorted) {
    const yc = (w.y0 + w.y1) / 2;
    const row = rowsOfWords.at(-1);
    const rowYc = row ? median(row.map((r) => (r.y0 + r.y1) / 2)) : -Infinity;
    if (row && Math.abs(yc - rowYc) <= 0.5 * h) row.push(w);
    else rowsOfWords.push([w]);
  }

  const gapSplit = 2.5 * h;
  const rows = rowsOfWords.map((rw) => {
    const byX = [...rw].sort((a, b) => a.x0 - b.x0);
    const segs: OcrWord[][] = [];
    for (const w of byX) {
      const seg = segs.at(-1);
      if (seg && w.x0 - seg.at(-1)!.x1 <= gapSplit) seg.push(w);
      else segs.push([w]);
    }
    return {
      y0: Math.min(...rw.map((w) => w.y0)),
      y1: Math.max(...rw.map((w) => w.y1)),
      segments: segs.map(toSegment),
    };
  });
  return { rows, lineHeight: h };
}

function toSegment(words: OcrWord[]): Segment {
  return {
    text: words.map((w) => w.text).join(' '),
    words,
    x0: Math.min(...words.map((w) => w.x0)),
    x1: Math.max(...words.map((w) => w.x1)),
    y0: Math.min(...words.map((w) => w.y0)),
    y1: Math.max(...words.map((w) => w.y1)),
  };
}

export interface LabelMatch {
  spec: FieldSpec;
  continuation: boolean;
  score: number;
  /** Text after a "Label: value" separator inside the same segment, if any. */
  inlineValue?: string;
}

const LABEL_MIN = 0.8;

function scoreLabel(text: string, alias: string): number {
  if (!text) return 0;
  if (text === alias) return 1;
  // "amount due inr" → "amount due": a multi-word alias followed by a qualifier.
  if (alias.includes(' ') && text.startsWith(alias + ' ') && text.length - alias.length <= 8) return 0.95;
  return levRatio(text, alias);
}

/** Best label (or label continuation) this text matches, if any scores ≥ 0.8. */
export function matchLabel(raw: string, specs: FieldSpec[]): LabelMatch | null {
  let candidates: { text: string; inlineValue?: string }[] = [{ text: normText(raw) }];
  const colon = raw.indexOf(':');
  if (colon > 0) candidates = [{ text: normText(raw.slice(0, colon)), inlineValue: raw.slice(colon + 1).trim() || undefined }, ...candidates];

  let best: LabelMatch | null = null;
  for (const c of candidates) {
    for (const spec of specs) {
      for (const a of spec.aliases) {
        const s = scoreLabel(c.text, a);
        if (s >= LABEL_MIN && (!best || s > best.score)) best = { spec, continuation: false, score: s, inlineValue: c.inlineValue };
      }
      for (const a of spec.continuations ?? []) {
        const s = scoreLabel(c.text, a);
        if (s >= LABEL_MIN && (!best || s > best.score)) best = { spec, continuation: true, score: s };
      }
    }
  }
  return best;
}

/**
 * Join a value that wrapped onto a new line. No space when the break is inside a word
 * ("…Visakhapatnam, A" + "ndhra Pradesh" → "Andhra") or inside a number ("75" + "2083");
 * otherwise one space ("Delhi -" + "334596").
 */
export function joinWrapped(a: string, b: string): string {
  const left = a.trimEnd();
  const right = b.trimStart();
  if (!left) return right;
  if (!right) return left;
  const midWord = /[A-Za-z]$/.test(left) && /^[a-z]/.test(right);
  const midNumber = /\d$/.test(left) && /^\d/.test(right);
  return midWord || midNumber ? left + right : `${left} ${right}`;
}

export interface ExtractedValue {
  text: string;
  conf: number;
}

export interface PairResult {
  values: Map<string, ExtractedValue>;
  /** Text above the first recognised label (normally the document title). */
  header: string;
  labelsFound: number;
}

const meanConf = (ws: OcrWord[]) => (ws.length ? ws.reduce((s, w) => s + w.conf, 0) / ws.length : 0);

/**
 * Pair labels with values. Works for both common layouts:
 *  - columnar: label on the left, value to its right on the same row;
 *  - stacked:  label on one row, value on the next row starting at about the same x.
 * Following rows whose text starts at the value's x (and holds no new label) are wrapped continuations.
 */
export function extractPairs(words: OcrWord[], specs: FieldSpec[]): PairResult {
  const { rows, lineHeight: h } = buildRows(words);
  const labelOf = rows.map((r) => r.segments.map((s) => matchLabel(s.text, specs)));
  // A wrapped line follows at about the page's normal row spacing; a much bigger gap ends the value.
  const gaps = rows.slice(1).map((r, k) => r.y0 - rows[k].y1).filter((g) => g > 0);
  const maxWrapGap = Math.max(2.5 * h, 1.5 * median(gaps));
  const values = new Map<string, ExtractedValue>();
  const firstLabelRow = labelOf.findIndex((ls) => ls.some((l) => l && !l.continuation));
  const header = rows
    .slice(0, firstLabelRow < 0 ? Math.min(rows.length, 3) : firstLabelRow)
    .map((r) => r.segments.map((s) => s.text).join(' '))
    .join(' | ');

  let labelsFound = 0;
  for (let i = 0; i < rows.length; i++) {
    rows[i].segments.forEach((seg, si) => {
      const lm = labelOf[i][si];
      if (!lm || lm.continuation) return;
      labelsFound++;
      if (values.has(lm.spec.key)) return; // first occurrence wins

      let text = lm.inlineValue ?? '';
      const used: OcrWord[] = [];
      let valueX: number | null = null;
      let lastRow = i;

      // Columnar: non-label segments to the right on the same row.
      const right = rows[i].segments.filter((s, k) => k > si && !labelOf[i][k] && s.x0 > seg.x1);
      if (right.length) {
        text = right.map((s) => s.text).join(' ');
        right.forEach((s) => used.push(...s.words));
        valueX = right[0].x0;
      } else if (!text && i + 1 < rows.length) {
        // Stacked: next row, starting near the label's x, not itself a label.
        const next = rows[i + 1];
        const k = next.segments.findIndex((s, kk) => !labelOf[i + 1][kk] && Math.abs(s.x0 - seg.x0) <= 2 * h);
        if (k >= 0 && next.y0 - rows[i].y1 <= 2 * h) {
          text = next.segments[k].text;
          used.push(...next.segments[k].words);
          valueX = next.segments[k].x0;
          lastRow = i + 1;
        }
      }

      // Wrapped continuation lines.
      if (valueX !== null) {
        for (let j = lastRow + 1; j < rows.length; j++) {
          if (rows[j].y0 - rows[j - 1].y1 > maxWrapGap) break;
          if (labelOf[j].some((l) => l && !(l.continuation && l.spec.key === lm.spec.key))) break;
          const k = rows[j].segments.findIndex((s, kk) => !labelOf[j][kk] && Math.abs(s.x0 - valueX!) <= 2 * h);
          if (k < 0) break;
          text = joinWrapped(text, rows[j].segments[k].text);
          used.push(...rows[j].segments[k].words);
        }
      }
      values.set(lm.spec.key, { text: text.trim(), conf: used.length ? meanConf(used) : lm.inlineValue ? meanConf(seg.words) : 0 });
    });
  }
  return { values, header, labelsFound };
}
