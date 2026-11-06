import { describe, expect, it } from 'vitest';
import { DOC_FIELDS } from '../../src/lib/kyc/extract/labels';
import { extractPairs, joinWrapped, type OcrWord } from '../../src/lib/kyc/ocr/layout';

/** Lay out words left to right from x, one per ~12px per character, on a 20px-high line at y. */
function line(text: string, x: number, y: number, conf = 95): OcrWord[] {
  const out: OcrWord[] = [];
  let cx = x;
  for (const t of text.split(' ')) {
    out.push({ text: t, conf, x0: cx, y0: y, x1: cx + t.length * 12, y1: y + 20 });
    cx += t.length * 12 + 10;
  }
  return out;
}

describe('joinWrapped', () => {
  it('joins without a space inside a word or number, otherwise with one', () => {
    expect(joinWrapped('Visakhapatnam, A', 'ndhra Pradesh - 118383')).toBe('Visakhapatnam, Andhra Pradesh - 118383');
    expect(joinWrapped('Kerala - 75', '2083')).toBe('Kerala - 752083');
    expect(joinWrapped('Delhi -', '334596')).toBe('Delhi - 334596');
    expect(joinWrapped('Ludhiana,', 'Punjab')).toBe('Ludhiana, Punjab');
  });
});

describe('extractPairs', () => {
  it('reads a columnar layout with a wrapped value and a label continuation', () => {
    const words = [
      ...line('Specimen: GST Registration Certificate', 80, 80),
      ...line('GSTIN', 90, 255),
      ...line('37IHKXV5167L1ZS', 520, 255),
      ...line('Address of principal', 90, 325),
      ...line('Shop/Unit 1, Tech Park Road, Visakhapatnam, A', 520, 325),
      ...line('place of business', 105, 395),
      ...line('ndhra Pradesh - 118383', 520, 395),
      ...line('Date of liability', 90, 465),
      ...line('2025-06-07', 520, 465),
    ];
    const r = extractPairs(words, DOC_FIELDS.gst_certificate);
    expect(r.header).toContain('GST Registration Certificate');
    expect(r.values.get('gstin')?.text).toBe('37IHKXV5167L1ZS');
    expect(r.values.get('address')?.text).toBe('Shop/Unit 1, Tech Park Road, Visakhapatnam, Andhra Pradesh - 118383');
    expect(r.values.get('dateOfLiability')?.text).toBe('2025-06-07');
  });

  it('leaves a blank value empty instead of taking the next row', () => {
    const words = [
      ...line('Udyam reg. number', 90, 255),
      ...line('Enterprise name', 90, 325),
      ...line('Vindhya Tours & Travels', 520, 325),
    ];
    const r = extractPairs(words, DOC_FIELDS.udyam_certificate);
    expect(r.values.get('udyamNumber')?.text).toBe('');
    expect(r.values.get('enterpriseName')?.text).toBe('Vindhya Tours & Travels');
  });

  it('reads a stacked layout (label above value)', () => {
    const words = [
      ...line('Name', 340, 134),
      ...line('Neha Kaur', 340, 159),
      ...line('For business', 340, 274),
      ...line('Vindhya Tours & Travels', 340, 299),
      ...line('Valid till', 340, 414),
      ...line('2028-03-26', 340, 440),
    ];
    const r = extractPairs(words, DOC_FIELDS.signatory_id);
    expect(r.values.get('name')?.text).toBe('Neha Kaur');
    expect(r.values.get('forBusiness')?.text).toBe('Vindhya Tours & Travels');
    expect(r.values.get('validTill')?.text).toBe('2028-03-26');
  });

  it('reads "Label: value" on one segment and tolerates a garbled label', () => {
    const words = [...line('Bil1 date: 05/07/2026', 90, 100), ...line('Biled to', 90, 160), ...line('Star Electronics', 520, 160)];
    const r = extractPairs(words, DOC_FIELDS.address_proof);
    expect(r.values.get('documentDate')?.text).toBe('05/07/2026');
    expect(r.values.get('billedTo')?.text).toBe('Star Electronics');
  });

  it('scales with resolution (same page at 2×)', () => {
    const words = [...line('Trade name', 90, 255), ...line('Star Electronics', 520, 255)].map((w) => ({
      ...w,
      x0: w.x0 * 2,
      x1: w.x1 * 2,
      y0: w.y0 * 2,
      y1: w.y1 * 2,
    }));
    expect(extractPairs(words, DOC_FIELDS.gst_certificate).values.get('tradeName')?.text).toBe('Star Electronics');
  });
});
