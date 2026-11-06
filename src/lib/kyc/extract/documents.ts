import type { KycConfig } from '../config';
import { enhance, prepareForOcr, rotate } from '../image/preprocess';
import type { OcrEngine, OcrResult } from '../ocr/engine';
import { extractPairs, type OcrWord, type PairResult } from '../ocr/layout';
import type { DocQuality, DocType, ExtractedDoc, Field, FieldsByDoc } from '../types';
import { DOC_TYPES } from '../types';
import { parseDocDate } from '../util/dates';
import { normText, squash } from '../util/normalize';
import { repairGstin, repairUdyam, validateGstin, validateUdyam } from './identifiers';
import { DOC_FIELDS, DOC_TITLES, isDiscarded, type FieldSpec } from './labels';

interface Attempt {
  ocr: OcrResult;
  pairs: PairResult;
  enhanced: boolean;
}

/** Labels needed before a read is considered successful (otherwise enhancement / rotation is tried). */
const MIN_LABELS = 2;

const better = (a: Attempt | null, b: Attempt) =>
  !a || b.pairs.labelsFound > a.pairs.labelsFound || (b.pairs.labelsFound === a.pairs.labelsFound && b.ocr.confidence > a.ocr.confidence);

async function attempt(engine: OcrEngine, png: Buffer, slot: DocType, enhanced: boolean): Promise<Attempt> {
  const ocr = await engine.recognize(png);
  return { ocr, pairs: extractPairs(ocr.words, DOC_FIELDS[slot]), enhanced };
}

/**
 * OCR one image, trying progressively harder only when needed:
 * as-is (or enhanced first if blurry) → enhanced → rotated 90/180/270°. Small skew is handled by tesseract.
 */
async function bestRead(engine: OcrEngine, input: Buffer, slot: DocType, config: KycConfig) {
  const prepared = await prepareForOcr(input);
  const blurry = prepared.blurScore < config.blurLaplacianVarMin;
  let enhancedPng: Buffer | null = null;
  const getEnhanced = async () => (enhancedPng ??= await enhance(prepared.png));

  const state: { best: Attempt | null } = { best: null };
  const consider = (a: Attempt) => {
    if (better(state.best, a)) state.best = a;
  };
  const labels = () => state.best?.pairs.labelsFound ?? 0;
  const good = () => labels() >= MIN_LABELS && (state.best?.ocr.confidence ?? 0) >= config.ocrLowConfidence;

  consider(await attempt(engine, blurry ? await getEnhanced() : prepared.png, slot, blurry));
  if (!good()) consider(await attempt(engine, blurry ? prepared.png : await getEnhanced(), slot, !blurry));
  if (labels() < MIN_LABELS) {
    for (const deg of [90, 180, 270] as const) {
      consider(await attempt(engine, await rotate(prepared.png, deg), slot, false));
      if (labels() >= MIN_LABELS) break;
    }
  }
  return { best: state.best!, blurScore: prepared.blurScore };
}

// ------------------------------------------------------------- classification

function titleScore(header: string, titles: string[]): { score: number; title: string | null } {
  const h = normText(header);
  let best = { score: 0, title: null as string | null };
  for (const t of titles) {
    if (h.includes(t)) return { score: 1, title: t };
    const tw = t.split(' ');
    const hw = new Set(h.split(' '));
    const s = tw.filter((w) => hw.has(w)).length / tw.length;
    if (s > best.score) best = { score: s, title: t };
  }
  return best;
}

/** Document type from the title text, falling back to which document's labels appear most. */
export function classify(words: OcrWord[], header: string): { type: DocType | 'unknown'; proofKind?: string } {
  let byTitle: { type: DocType; score: number; title: string | null } | null = null;
  for (const t of DOC_TYPES) {
    const s = titleScore(header, DOC_TITLES[t]);
    if (!byTitle || s.score > byTitle.score) byTitle = { type: t, ...s };
  }
  const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
  if (byTitle && byTitle.score >= 0.75) {
    return { type: byTitle.type, proofKind: byTitle.type === 'address_proof' && byTitle.title ? titleCase(byTitle.title) : undefined };
  }
  let byLabels: { type: DocType; n: number } | null = null;
  for (const t of DOC_TYPES) {
    const n = extractPairs(words, DOC_FIELDS[t]).labelsFound;
    if (!byLabels || n > byLabels.n) byLabels = { type: t, n };
  }
  return byLabels && byLabels.n >= MIN_LABELS ? { type: byLabels.type } : { type: 'unknown' };
}

// ------------------------------------------------------------- field building

const EMPTY: Field = { value: null, raw: null, confidence: 0 };

function toField(spec: FieldSpec, text: string | undefined, conf: number): Field {
  const raw = squash(text) || null;
  if (!raw) return { ...EMPTY };
  const confidence = Math.round(conf);
  switch (spec.kind) {
    case 'date':
      return { value: parseDocDate(raw), raw, confidence };
    case 'gstin': {
      const r = repairGstin(raw)!;
      return { value: r.value || null, raw, confidence, repaired: r.repaired && r.value !== raw.replace(/\s/g, '') };
    }
    case 'udyam': {
      const r = repairUdyam(raw)!;
      return { value: r.value || null, raw, confidence, repaired: r.repaired && r.value !== raw.replace(/\s/g, '') };
    }
    default:
      return { value: raw, raw, confidence };
  }
}

/**
 * Whole-page fallback for identifiers when the label could not be paired (unfamiliar layout, garbled
 * label). Only accepts a token that becomes a fully valid identifier after the standard repair.
 */
function scanIdentifier(words: OcrWord[], kind: 'gstin' | 'udyam'): Field | null {
  const text = words.map((w) => w.text).join(' ');
  if (kind === 'gstin') {
    for (const m of text.matchAll(/\b[0-9A-Z]{15}\b/g)) {
      const r = repairGstin(m[0])!;
      if (validateGstin(r.value) === null) return { value: r.value, raw: m[0], confidence: 0, repaired: r.value !== m[0] };
    }
  } else {
    for (const m of text.matchAll(/UD[YV]AM[\s\-–]*[A-Z0-9]{2}[\s\-–]*[0-9OD]{2}[\s\-–]*[0-9OIl]{7}/gi)) {
      const r = repairUdyam(m[0])!;
      if (validateUdyam(r.value) === null) return { value: r.value, raw: m[0], confidence: 0, repaired: r.value !== m[0] };
    }
  }
  return null;
}

function buildFields<T extends DocType>(slot: T, words: OcrWord[], pairs: PairResult): FieldsByDoc[T] {
  const out: Record<string, Field> = {};
  for (const spec of DOC_FIELDS[slot]) {
    if (isDiscarded(spec.key)) continue;
    const v = pairs.values.get(spec.key);
    out[spec.key] = toField(spec, v?.text, v?.conf ?? 0);
    if (!out[spec.key].value && !pairs.values.has(spec.key) && (spec.kind === 'gstin' || spec.kind === 'udyam')) {
      out[spec.key] = scanIdentifier(words, spec.kind) ?? out[spec.key];
    }
  }
  return out as unknown as FieldsByDoc[T];
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p.finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`OCR timed out after ${ms} ms`)), ms);
    }),
  ]);
}

function emptyFields<T extends DocType>(slot: T): FieldsByDoc[T] {
  const out: Record<string, Field> = {};
  for (const spec of DOC_FIELDS[slot]) if (!isDiscarded(spec.key)) out[spec.key] = { ...EMPTY };
  return out as unknown as FieldsByDoc[T];
}

/** Read one uploaded image into structured fields. Never throws: failures give `readable: false`. */
export async function extractDocument<T extends DocType>(
  slot: T,
  image: Buffer,
  engine: OcrEngine,
  config: KycConfig,
): Promise<ExtractedDoc<FieldsByDoc[T]>> {
  try {
    const { best, blurScore } = await withTimeout(bestRead(engine, image, slot, config), config.ocrTimeoutMs);
    const { type, proofKind } = classify(best.ocr.words, best.pairs.header);
    const fields = buildFields(slot, best.ocr.words, best.pairs);
    const readable = Object.values(fields as unknown as Record<string, Field>).some((f) => f.value != null);
    const quality: DocQuality = {
      skewDeg: Math.round(best.ocr.skewDeg * 10) / 10,
      blurScore: Math.round(blurScore),
      enhanced: best.enhanced,
      meanConfidence: Math.round(best.ocr.confidence),
    };
    return { slot, detectedType: type, title: best.pairs.header || null, proofKind, readable, fields, quality };
  } catch {
    return {
      slot,
      detectedType: 'unknown',
      title: null,
      readable: false,
      fields: emptyFields(slot),
      quality: { skewDeg: 0, blurScore: 0, enhanced: false, meanConfidence: 0 },
    };
  }
}
