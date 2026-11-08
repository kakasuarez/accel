/**
 * The customer KYC upload path (POST /api/leads/:id/kyc) without the database: multipart parsing as a browser
 * sends it, then the unchanged engine. Guards the integration rules: the document set is decided by the
 * engine's completeness rule, and stored findings carry no values read from the documents.
 */
import fs from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, validateKyc } from '../../src/lib/kyc';
import { shutdownOcr } from '../../src/lib/kyc/ocr/engine';
import { publicFindings } from '../../src/lib/kyc/store';
import type { DocType } from '../../src/lib/kyc/types';
import { hasKycConsent, readKycUpload, UploadError } from '../../src/lib/kyc/upload';

afterAll(() => shutdownOcr());

const file = (id: string, doc: DocType) => new File([fs.readFileSync(`kyc_documents/${id}_${doc}.png`)], `${doc}.png`, { type: 'image/png' });
/** An <input type="file"> left empty is sent as a nameless, empty file part. */
const emptyInput = () => new File([], '', { type: 'application/octet-stream' });

function form(parts: Partial<Record<DocType, File>>): FormData {
  const f = new FormData();
  for (const slot of ['gst_certificate', 'udyam_certificate', 'signatory_id', 'address_proof'] as const) f.append(slot, parts[slot] ?? emptyInput());
  return f;
}

const run = async (parts: Partial<Record<DocType, File>>) =>
  validateKyc({ applicantId: 'test', files: await readKycUpload(form(parts)) }, { config: DEFAULT_CONFIG });

describe('KYC upload integration', () => {
  it('GST without Udyam is a complete set (K05 is approved)', async () => {
    const r = await run({ gst_certificate: file('K05', 'gst_certificate'), signatory_id: file('K05', 'signatory_id'), address_proof: file('K05', 'address_proof') });
    expect(r.findings.map((f) => f.code)).toContain('UDYAM_ABSENT');
    expect(r.decision).toBe('APPROVE');
  });

  it('rejects a set with neither GST nor Udyam', async () => {
    const r = await run({ signatory_id: file('K05', 'signatory_id'), address_proof: file('K05', 'address_proof') });
    expect(r.decision).toBe('REJECT');
    expect(r.findings.map((f) => f.code)).toContain('NO_BUSINESS_PROOF');
  });

  it('rejects a set without the signatory ID or address proof', async () => {
    const r = await run({ gst_certificate: file('K05', 'gst_certificate') });
    expect(r.decision).toBe('REJECT');
    expect(r.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['DOC_MISSING_SIGNATORY_ID', 'DOC_MISSING_ADDRESS_PROOF']));
  });

  it('counts consent only when the customer ticked the box', () => {
    expect(hasKycConsent(form({}))).toBe(false);
    const ticked = form({});
    ticked.append('consent', 'yes');
    expect(hasKycConsent(ticked)).toBe(true);
    const other = form({});
    other.append('consent', 'on');
    expect(hasKycConsent(other)).toBe(false);
  });

  it('refuses files that are not images, whatever their name', async () => {
    const f = form({ signatory_id: new File(['not an image'], 'id.png', { type: 'image/png' }) });
    await expect(readKycUpload(f)).rejects.toBeInstanceOf(UploadError);
  });

  it('stores only code, severity, document and message', async () => {
    const r = await run({ gst_certificate: file('K06', 'gst_certificate'), signatory_id: file('K06', 'signatory_id'), address_proof: file('K06', 'address_proof') });
    for (const f of publicFindings(r.findings)) expect(Object.keys(f).sort()).toEqual(expect.arrayContaining(['code', 'message', 'severity']));
    expect(publicFindings(r.findings).some((f) => 'expected' in f || 'actual' in f)).toBe(false);
  });
});
