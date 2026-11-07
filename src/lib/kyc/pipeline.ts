import { resolveConfig, type KycConfig } from './config';
import { evaluateBundle } from './evaluate';
import { extractDocument } from './extract/documents';
import { defaultOcrEngine, type OcrEngine } from './ocr/engine';
import { defaultRegistries } from './registry/csvRegistry';
import type { ExtractedBundle, GstRegistry, KycInput, KycResult, UdyamRegistry } from './types';

export interface KycOptions {
  config?: Partial<KycConfig>;
  ocr?: OcrEngine;
  gstRegistry?: GstRegistry;
  udyamRegistry?: UdyamRegistry;
}

/** OCR all uploaded documents in parallel. Image buffers stay in memory and are not retained. */
export async function extractDocuments(input: KycInput, opts: KycOptions = {}): Promise<ExtractedBundle> {
  const config = resolveConfig(opts.config);
  const ocr = opts.ocr ?? defaultOcrEngine();
  const f = input.files;
  const [gst, udyam, signatory, addressProof] = await Promise.all([
    f.gst_certificate && extractDocument('gst_certificate', f.gst_certificate, ocr, config),
    f.udyam_certificate && extractDocument('udyam_certificate', f.udyam_certificate, ocr, config),
    f.signatory_id && extractDocument('signatory_id', f.signatory_id, ocr, config),
    f.address_proof && extractDocument('address_proof', f.address_proof, ocr, config),
  ]);
  return { gst, udyam, signatory, addressProof };
}

/** Full validation: OCR the documents, run every check, decide Approve / Manual review / Reject. */
export async function validateKyc(input: KycInput, opts: KycOptions = {}): Promise<KycResult> {
  const bundle = await extractDocuments(input, opts);
  const regs = opts.gstRegistry && opts.udyamRegistry ? null : defaultRegistries();
  return evaluateBundle(bundle, {
    config: opts.config,
    gstRegistry: opts.gstRegistry ?? regs!.gst,
    udyamRegistry: opts.udyamRegistry ?? regs!.udyam,
    applicantId: input.applicantId,
    requireGst: input.requireGst,
  });
}
