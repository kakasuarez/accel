/**
 * Debug helper: show what the validator's OCR pipeline sees for one image.
 *   npx tsx scripts/debug-ocr.ts <image> <doc_type>
 */
import fs from 'node:fs';
import { resolveConfig } from '../src/lib/kyc/config';
import { extractDocument } from '../src/lib/kyc/extract/documents';
import { prepareForOcr } from '../src/lib/kyc/image/preprocess';
import { defaultOcrEngine, shutdownOcr } from '../src/lib/kyc/ocr/engine';
import { buildRows } from '../src/lib/kyc/ocr/layout';
import type { DocType } from '../src/lib/kyc/types';

const [file, slot] = process.argv.slice(2) as [string, DocType];
const buf = fs.readFileSync(file);
const engine = defaultOcrEngine();
const prep = await prepareForOcr(buf);
const ocr = await engine.recognize(prep.png);
console.log(`blur=${prep.blurScore.toFixed(0)} conf=${ocr.confidence} skew=${ocr.skewDeg.toFixed(2)}`);
for (const r of buildRows(ocr.words).rows) console.log(`y=${r.y0}-${r.y1} | ` + r.segments.map((s) => `[${s.x0}] ${s.text}`).join('  ||  '));
const doc = await extractDocument(slot, buf, engine, resolveConfig());
console.log(JSON.stringify({ ...doc, title: doc.title }, null, 1));
await shutdownOcr();
