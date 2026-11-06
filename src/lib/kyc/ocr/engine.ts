import os from 'node:os';
import { createRequire } from 'node:module';
import { createScheduler, createWorker, OEM, PSM, type Scheduler } from 'tesseract.js';
import type { OcrWord } from './layout';

export interface OcrResult {
  words: OcrWord[];
  /** Page-level mean confidence, 0–100. */
  confidence: number;
  /** Small skew tesseract corrected (rotateAuto), in degrees. */
  skewDeg: number;
}

export interface OcrEngine {
  recognize(png: Buffer): Promise<OcrResult>;
}

const require = createRequire(import.meta.url);

/**
 * English LSTM model shipped in the @tesseract.js-data/eng npm package: OCR runs fully offline,
 * so no document data or model download touches the network (DPDP).
 */
function langPath(): string {
  return (require('@tesseract.js-data/eng') as { langPath: string }).langPath;
}

class TesseractEngine implements OcrEngine {
  private scheduler: Promise<Scheduler> | null = null;

  constructor(private readonly workers = Math.max(1, Math.min(4, os.cpus().length - 1))) {}

  private init(): Promise<Scheduler> {
    this.scheduler ??= (async () => {
      const scheduler = createScheduler();
      const ws = await Promise.all(
        Array.from({ length: this.workers }, async () => {
          const w = await createWorker('eng', OEM.LSTM_ONLY, { langPath: langPath(), gzip: true, cacheMethod: 'none' });
          // Sparse text: finds label/value fragments anywhere on the page without assuming a reading order.
          await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, user_defined_dpi: '300', preserve_interword_spaces: '1' });
          return w;
        }),
      );
      ws.forEach((w) => scheduler.addWorker(w));
      return scheduler;
    })();
    return this.scheduler;
  }

  async recognize(png: Buffer): Promise<OcrResult> {
    const scheduler = await this.init();
    const { data } = await scheduler.addJob('recognize', png, { rotateAuto: true }, { blocks: true, text: false });
    const words: OcrWord[] = [];
    for (const b of data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const l of p.lines)
          for (const w of l.words) words.push({ text: w.text, conf: w.confidence, ...w.bbox });
    return { words, confidence: data.confidence, skewDeg: ((data.rotateRadians ?? 0) * 180) / Math.PI };
  }

  async terminate() {
    if (this.scheduler) await (await this.scheduler).terminate();
    this.scheduler = null;
  }
}

const g = globalThis as unknown as { __kycOcr?: TesseractEngine };

/** Process-wide worker pool, created lazily and reused across requests (and Next.js dev reloads). */
export function defaultOcrEngine(): TesseractEngine {
  g.__kycOcr ??= new TesseractEngine();
  return g.__kycOcr;
}

export async function shutdownOcr() {
  await g.__kycOcr?.terminate();
  g.__kycOcr = undefined;
}
