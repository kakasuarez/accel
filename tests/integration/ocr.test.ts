/**
 * End-to-end OCR tests on the sample documents and on synthetic variants of them (rotation, skew,
 * low resolution, JPEG artefacts, noise, low contrast). The variants check that extraction does not
 * depend on the exact pixels of the sample set.
 */
import fs from 'node:fs';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveConfig } from '../../src/lib/kyc/config';
import { extractDocument } from '../../src/lib/kyc/extract/documents';
import { defaultOcrEngine, shutdownOcr } from '../../src/lib/kyc/ocr/engine';
import { validateKyc } from '../../src/lib/kyc/pipeline';
import { DOC_TYPES, type DocType, type KycResult } from '../../src/lib/kyc/types';

const DIR = 'kyc_documents';
const read = (id: string, doc: DocType) => fs.readFileSync(`${DIR}/${id}_${doc}.png`);
const engine = defaultOcrEngine();
const config = resolveConfig();

afterAll(() => shutdownOcr());

async function applicant(id: string): Promise<KycResult> {
  const files: Partial<Record<DocType, Buffer>> = {};
  for (const d of DOC_TYPES) if (fs.existsSync(`${DIR}/${id}_${d}.png`)) files[d] = read(id, d);
  return validateKyc({ applicantId: id, files });
}
const codes = (r: KycResult) => r.findings.map((f) => f.code);

describe('sample applicants', () => {
  it('K01: blank Udyam number fails the mandatory registry check; GST is cancelled', async () => {
    const r = await applicant('K01');
    expect(r.decision).toBe('REJECT');
    expect(codes(r)).toEqual(expect.arrayContaining(['UDYAM_NUMBER_MISSING', 'UDYAM_NOT_VERIFIED', 'GST_STATUS_CANCELLED']));
  });

  it('K05: GST only, everything consistent → approved', async () => {
    const r = await applicant('K05');
    expect(codes(r)).toContain('UDYAM_ABSENT');
    expect(r.decision).toBe('APPROVE');
  });

  it('K06: GSTIN with an invalid check digit is rejected', async () => {
    expect(codes(await applicant('K06'))).toContain('GSTIN_CHECKSUM_INVALID');
  });

  it('K04: unreadable (heavily blurred) GST certificate cannot be verified → rejected', async () => {
    const r = await applicant('K04');
    expect(codes(r)).toEqual(expect.arrayContaining(['DOC_UNREADABLE', 'GST_NOT_VERIFIED']));
  });
});

describe('extraction on real images', () => {
  it('reads a skewed scan (K02) and repairs the GSTIN', async () => {
    const d = await extractDocument('gst_certificate', read('K02', 'gst_certificate'), engine, config);
    expect(d.detectedType).toBe('gst_certificate');
    expect(d.fields.gstin.value).toBe('19EOGXH4115Y1ZL');
    expect(d.fields.address.value).toBe('Shop/Unit 199, Station Road, Kolkata, West Bengal - 347550');
    expect(Math.abs(d.quality.skewDeg)).toBeGreaterThan(3);
  });

  it('classifies an address proof and names its kind', async () => {
    const d = await extractDocument('address_proof', read('K01', 'address_proof'), engine, config);
    expect(d.detectedType).toBe('address_proof');
    expect(d.proofKind).toBe('Electricity Bill');
    expect(d.fields.documentDate.value).toBe('2026-06-26');
  });

  it('detects a document uploaded in the wrong slot', async () => {
    const d = await extractDocument('address_proof', read('K01', 'udyam_certificate'), engine, config);
    expect(d.detectedType).toBe('udyam_certificate');
  });
});

// ------------------------------------------------------------ synthetic variants

function noisy(seed: number) {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return async (img: Buffer) => {
    const { data, info } = await sharp(img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, data[i] + Math.round((rand() - 0.5) * 60)));
    return sharp(data, { raw: info }).png().toBuffer();
  };
}

const VARIANTS: Record<string, (img: Buffer) => Promise<Buffer>> = {
  'rotated 90°': (i) => sharp(i).rotate(90).png().toBuffer(),
  'rotated 180°': (i) => sharp(i).rotate(180).png().toBuffer(),
  'rotated 270°': (i) => sharp(i).rotate(270).png().toBuffer(),
  'skewed 4°': (i) => sharp(i).rotate(4, { background: '#ffffff' }).png().toBuffer(),
  'downscaled to 60%': async (i) => sharp(i).resize({ width: Math.round(((await sharp(i).metadata()).width ?? 1000) * 0.6) }).png().toBuffer(),
  'JPEG quality 30': (i) => sharp(i).jpeg({ quality: 30 }).toBuffer(),
  'gaussian-ish noise': noisy(42),
  'low contrast': (i) => sharp(i).linear(0.5, 110).png().toBuffer(),
};

describe.each(Object.entries(VARIANTS))('robustness: %s', (_name, transform) => {
  it('GST certificate (K05) still yields the same key fields', async () => {
    const d = await extractDocument('gst_certificate', await transform(read('K05', 'gst_certificate')), engine, config);
    expect(d.detectedType).toBe('gst_certificate');
    expect(d.fields.gstin.value).toBe('32TZAXB5481U1Z1');
    expect(d.fields.tradeName.value).toBe('Balaji Realty LLP');
    expect(d.fields.dateOfLiability.value).toBe('2020-07-26');
  });

  it('signatory ID (K12) still yields the same key fields', async () => {
    const d = await extractDocument('signatory_id', await transform(read('K12', 'signatory_id')), engine, config);
    expect(d.detectedType).toBe('signatory_id');
    expect(d.fields.name.value).toBe('Pooja Agarwal');
    expect(d.fields.forBusiness.value).toBe('Star Electronics');
    expect(d.fields.validTill.value).toBe('2029-03-03');
  });
});
