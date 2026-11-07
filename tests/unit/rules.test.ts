import { describe, expect, it } from 'vitest';
import { evaluateBundle } from '../../src/lib/kyc/evaluate';
import type { ExtractedBundle, KycResult } from '../../src/lib/kyc/types';
import { addressDoc, goodBundle, GST_REC, gstDoc, registries, signatoryDoc, udyamDoc, UDYAM_REC } from '../helpers';

const run = (bundle: ExtractedBundle, regs = registries(), config = {}) => evaluateBundle(bundle, { ...regs, config });
const codes = (r: KycResult) => r.findings.map((f) => f.code);

describe('decision', () => {
  it('approves a complete, consistent applicant', () => {
    const r = run(goodBundle());
    expect(r.findings.filter((f) => f.severity !== 'INFO')).toEqual([]);
    expect(r.decision).toBe('APPROVE');
  });

  it('records every rule as PASS, FAIL or SKIPPED', () => {
    expect(run(goodBundle()).checks.map((c) => c.ruleId)).toHaveLength(12);
  });
});

describe('completeness (rules §2)', () => {
  it('rejects when neither GST nor Udyam is present', () => {
    const r = run({ signatory: signatoryDoc(), addressProof: addressDoc() });
    expect(codes(r)).toContain('NO_BUSINESS_PROOF');
    expect(r.decision).toBe('REJECT');
  });

  it('accepts GST without Udyam (info only)', () => {
    const r = run({ gst: gstDoc(), signatory: signatoryDoc(), addressProof: addressDoc() });
    expect(codes(r)).toContain('UDYAM_ABSENT');
    expect(r.decision).toBe('APPROVE');
  });

  it('accepts Udyam without GST and checks names against Udyam', () => {
    const r = run({ udyam: udyamDoc(), signatory: signatoryDoc(), addressProof: addressDoc() });
    expect(codes(r)).toContain('GST_ABSENT_PAN_UNVERIFIABLE');
    expect(r.decision).toBe('APPROVE');
  });

  it('rejects Udyam without GST when the applicant said they are GST-registered', () => {
    const regs = registries();
    const r = evaluateBundle({ udyam: udyamDoc(), signatory: signatoryDoc(), addressProof: addressDoc() }, { ...regs, requireGst: true });
    expect(codes(r)).toContain('GST_REQUIRED');
    expect(codes(r)).not.toContain('GST_ABSENT_PAN_UNVERIFIABLE');
    expect(r.decision).toBe('REJECT');
  });

  it('rejects with GST_REQUIRED, not NO_BUSINESS_PROOF, when GST is required and nothing was uploaded', () => {
    const regs = registries();
    const r = evaluateBundle({ signatory: signatoryDoc(), addressProof: addressDoc() }, { ...regs, requireGst: true });
    expect(codes(r)).toContain('GST_REQUIRED');
    expect(codes(r)).not.toContain('NO_BUSINESS_PROOF');
  });

  it('approves GST without Udyam when GST is required', () => {
    const regs = registries();
    const r = evaluateBundle({ gst: gstDoc(), signatory: signatoryDoc(), addressProof: addressDoc() }, { ...regs, requireGst: true });
    expect(r.decision).toBe('APPROVE');
  });

  it('rejects when the signatory ID or address proof is missing', () => {
    const b = goodBundle();
    delete b.signatory;
    delete b.addressProof;
    expect(codes(run(b))).toEqual(expect.arrayContaining(['DOC_MISSING_SIGNATORY_ID', 'DOC_MISSING_ADDRESS_PROOF']));
  });

  it('treats the wrong document in a slot as absent', () => {
    const b = goodBundle();
    b.addressProof = addressDoc({}, { detectedType: 'gst_certificate' });
    const r = run(b);
    expect(codes(r)).toEqual(expect.arrayContaining(['DOC_TYPE_MISMATCH', 'DOC_MISSING_ADDRESS_PROOF']));
    expect(r.decision).toBe('REJECT');
  });
});

describe('registry gate (government-source verification is mandatory)', () => {
  it('rejects when the Udyam number is blank, even though everything else matches', () => {
    const b = goodBundle();
    b.udyam = udyamDoc({ udyamNumber: null });
    const r = run(b);
    expect(codes(r)).toEqual(expect.arrayContaining(['UDYAM_NUMBER_MISSING', 'UDYAM_NOT_VERIFIED']));
    expect(r.decision).toBe('REJECT');
    expect(r.checks.find((c) => c.ruleId === 'registry.udyam')?.status).toBe('FAIL');
  });

  it('rejects an unreadable GST certificate', () => {
    const b = goodBundle();
    b.gst = gstDoc({ gstin: null, legalName: null, tradeName: null, constitution: null, address: null, dateOfLiability: null, registrationType: null }, { readable: false });
    expect(codes(run(b))).toEqual(expect.arrayContaining(['DOC_UNREADABLE', 'GST_NOT_VERIFIED']));
  });

  it('rejects a GSTIN with a bad check digit, and one not in the registry', () => {
    const b = goodBundle();
    b.gst = gstDoc({ gstin: '37IHKXV5167L1ZT' });
    expect(codes(run(b))).toEqual(expect.arrayContaining(['GSTIN_CHECKSUM_INVALID', 'GST_NOT_VERIFIED']));
    expect(codes(run(goodBundle(), registries([])))).toContain('GSTIN_NOT_FOUND');
  });

  it('resolves a single look-alike misread only to an exact registry key', () => {
    const rec = { ...GST_REC, gstin: '27QHJXK0658U1ZL', state: 'Maharashtra' };
    const b = goodBundle();
    b.gst = gstDoc({ gstin: '27QHIXK0658U1ZL' });
    const r = run(b, registries([rec]));
    expect(codes(r)).toContain('OCR_CORRECTED');
    expect(codes(r)).not.toContain('GSTIN_CHECKSUM_INVALID');
    // Same misread, but the corrected GSTIN is not in the registry → the checksum failure stands.
    expect(codes(run(b, registries([])))).toContain('GSTIN_CHECKSUM_INVALID');
  });

  it.each([
    ['Cancelled', 'GST_STATUS_CANCELLED', 'REJECT'],
    ['Suspended', 'GST_STATUS_SUSPENDED', 'MANUAL_REVIEW'],
    ['Provisional', 'GST_STATUS_UNKNOWN', 'MANUAL_REVIEW'],
  ])('GST status %s → %s', (status, code, decision) => {
    const r = run(goodBundle(), registries([{ ...GST_REC, status }]));
    expect(codes(r)).toContain(code);
    expect(r.decision).toBe(decision);
  });

  it('flags certificate values that differ from the registry (possible tampering)', () => {
    const b = goodBundle();
    b.gst = gstDoc({ tradeName: 'Vindhya Tours & Travels Agency', dateOfLiability: '2025-06-08' });
    b.udyam = udyamDoc({ city: 'Vizag' });
    const r = run(b);
    const fields = r.findings.filter((f) => f.code.endsWith('_CERT_MISMATCH')).map((f) => f.field);
    expect(fields).toEqual(expect.arrayContaining(['tradeName', 'registrationDate', 'city']));
    expect(r.decision).toBe('MANUAL_REVIEW');
  });

  it('treats a different date of Udyam registration as information; severity can be raised', () => {
    const b = goodBundle();
    b.udyam = udyamDoc({ dateOfRegistration: '2024-03-25' });
    const r = run(b);
    expect(r.findings.find((x) => x.field === 'dateOfRegistration')).toMatchObject({
      code: 'UDYAM_REG_DATE_DIFFERS',
      severity: 'INFO',
      expected: '2024-03-24',
      actual: '2024-03-25',
    });
    expect(r.decision).toBe('APPROVE');
    expect(run(b, registries(), { severityOverrides: { UDYAM_REG_DATE_DIFFERS: 'REVIEW' } }).decision).toBe('MANUAL_REVIEW');
  });

  it('treats a different major activity as an update after printing (info only)', () => {
    const b = goodBundle();
    b.udyam = udyamDoc({ majorActivity: 'Trading' });
    const r = run(b);
    expect(r.findings.find((x) => x.field === 'majorActivity')).toMatchObject({ code: 'UDYAM_ACTIVITY_UPDATED', severity: 'INFO', expected: 'Services' });
    expect(r.decision).toBe('APPROVE');
  });

  it('labels a GSTIN state code that disagrees with the registry state', () => {
    const r = run(goodBundle(), registries([{ ...GST_REC, state: 'Telangana' }]));
    expect(r.findings.find((x) => x.code === 'STATE_MISMATCH' && x.doc === 'gst_certificate')?.field).toBe('gstin↔gstRegistry.state');
  });
});

describe('consistency (rules §6)', () => {
  it('uses registry values once verified, so a garbled certificate name does not cause name mismatches', () => {
    const b = goodBundle();
    b.gst = gstDoc({ tradeName: 'Vindhya Tours & Trave1s' });
    const r = run(b);
    expect(codes(r)).not.toContain('NAME_MISMATCH_UDYAM');
    expect(codes(r)).not.toContain('SIGNATORY_BUSINESS_MISMATCH');
  });

  it('flags a different business on Udyam, the bill and the signatory ID', () => {
    const b = goodBundle();
    b.udyam = udyamDoc({ enterpriseName: 'Ganga Stationers' });
    b.addressProof = addressDoc({ billedTo: 'Ganga Stationers' });
    b.signatory = signatoryDoc({ forBusiness: 'Ganga Stationers' });
    const r = run(b, registries([GST_REC], [{ ...UDYAM_REC, enterpriseName: 'Ganga Stationers' }]));
    expect(codes(r)).toEqual(expect.arrayContaining(['NAME_MISMATCH_UDYAM', 'NAME_MISMATCH_ADDR_PROOF', 'SIGNATORY_BUSINESS_MISMATCH']));
  });

  it("accepts a proprietor's bill in the owner's own name", () => {
    const b = goodBundle();
    b.addressProof = addressDoc({ billedTo: 'Neha Kaur' });
    expect(codes(run(b))).not.toContain('NAME_MISMATCH_ADDR_PROOF');
  });

  it('flags a proprietor who is not the signatory', () => {
    const b = goodBundle();
    b.signatory = signatoryDoc({ name: 'Rahul Verma' });
    expect(codes(run(b))).toContain('PROPRIETOR_NAME_MISMATCH');
  });

  it('flags a state and address that differ from the place of business', () => {
    const b = goodBundle();
    b.addressProof = addressDoc({ address: 'Shop/Unit 9, MG Road, Chennai, Tamil Nadu - 600001' });
    expect(codes(run(b))).toEqual(expect.arrayContaining(['STATE_MISMATCH', 'ADDRESS_MISMATCH_PPOB']));
  });

  it('flags GST and Udyam in different cities', () => {
    const r = run(goodBundle(), registries([GST_REC], [{ ...UDYAM_REC, city: 'Hyderabad' }]));
    expect(codes(r)).toContain('CITY_MISMATCH_UDYAM');
  });
});

describe('dates (today = 2026-07-15)', () => {
  it.each([
    ['2026-04-16', false],
    ['2026-04-15', true],
  ])('address proof dated %s stale=%s', (date, stale) => {
    const b = goodBundle();
    b.addressProof = addressDoc({ documentDate: date });
    expect(codes(run(b)).includes('ADDR_PROOF_STALE')).toBe(stale);
  });

  it('rejects a future document date but not a future ID expiry', () => {
    const b = goodBundle();
    b.addressProof = addressDoc({ documentDate: '2026-07-16' });
    const r = run(b);
    expect(codes(r)).toContain('DATE_IN_FUTURE');
    expect(r.findings.filter((f) => f.code === 'DATE_IN_FUTURE')).toHaveLength(1);
    expect(r.decision).toBe('REJECT');
  });

  it('rejects an expired signatory ID; severity can be overridden', () => {
    const b = goodBundle();
    b.signatory = signatoryDoc({ validTill: '2026-07-14' });
    expect(run(b).decision).toBe('REJECT');
    expect(run(b, registries(), { severityOverrides: { SIGNATORY_ID_EXPIRED: 'REVIEW' } }).decision).toBe('MANUAL_REVIEW');
  });

  it('honours a different "today"', () => {
    const b = goodBundle();
    expect(codes(run(b, registries(), { today: '2026-12-31' }))).toContain('ADDR_PROOF_STALE');
  });
});

describe('DPDP output', () => {
  it('masks identifiers in the extracted values and in findings', () => {
    const b = goodBundle();
    b.gst = gstDoc({ gstin: '37IHKXV5167L1ZT' });
    const r = run(b);
    expect(r.extracted.gst_certificate?.gstin).toBe('37**********1ZT');
    expect(r.extracted.signatory_id?.idNumber).toBe('**********190');
    expect(JSON.stringify(r)).not.toContain('37IHKXV5167L1ZT');
  });
});
