import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { ApiError, route } from '@/lib/http';
import { DEFAULT_CONFIG, KycConfigError, validateKyc } from '@/lib/kyc';
import { canSubmitKyc, latestKycCheck, saveKycCheck } from '@/lib/kyc/store';
import { hasKycConsent, readKycUpload, UploadError } from '@/lib/kyc/upload';
import { ownLead } from '@/lib/leads/access';
import { getLead, setStage } from '@/lib/leads/repository';
import { STAGE_AFTER_QUOTE } from '@/lib/leads/stages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// OCR of four images can take a while on a cold start.
export const maxDuration = 60;

const KYC_STAGE_DONE = 'KYC complete' as const;

/** GET /api/leads/:id/kyc → { latest: KycCheck | null, canSubmit } */
export const GET = route(async (_request, { params }: RouteContext<'/api/leads/[id]/kyc'>) => {
  const user = await requireUser();
  const lead = await ownLead(user, (await params).id);
  const latest = await latestKycCheck(lead.id);
  return NextResponse.json({ latest, canSubmit: lead.status === 'open' && lead.stage === STAGE_AFTER_QUOTE && canSubmitKyc(latest) });
});

/**
 * POST /api/leads/:id/kyc (multipart/form-data)
 * Parts: consent ("yes", required), gst_certificate, udyam_certificate, signatory_id, address_proof. Signatory ID and address proof are
 * required and at least one of GST / Udyam, but that is decided by the engine's completeness rule (it rejects
 * with a reason code), not here. Files stay in memory; only the decision and masked findings are stored.
 * APPROVE moves the lead to "KYC complete"; MANUAL_REVIEW waits for staff; REJECT and MANUAL_REVIEW allow a new
 * attempt (the newest one counts).
 */
export const POST = route(async (request, { params }: RouteContext<'/api/leads/[id]/kyc'>) => {
  const user = await requireUser();
  const lead = await ownLead(user, (await params).id);
  // Read the upload before any 409: answering while the body is still arriving makes the server drop the
  // connection, and the browser can then report a network error instead of the message.
  const form = await request.formData().catch(() => {
    throw new ApiError(400, 'invalid_request', 'Expected multipart/form-data.');
  });
  if (lead.status !== 'open') throw new ApiError(409, 'closed', 'This request is closed.');
  if (lead.stage !== STAGE_AFTER_QUOTE) throw new ApiError(409, 'not_ready', 'KYC opens once you have accepted your quote.');
  if (!canSubmitKyc(await latestKycCheck(lead.id))) throw new ApiError(409, 'verified', 'Your business is already verified.');
  // DPDP: no document is read without the customer's explicit consent.
  if (!hasKycConsent(form)) throw new ApiError(400, 'consent_required', 'Please agree to the document check before uploading.');

  let files;
  try {
    files = await readKycUpload(form);
  } catch (err) {
    if (err instanceof UploadError) throw new ApiError(400, 'invalid_file', err.message);
    throw err;
  }

  let result;
  try {
    // Always the default config: its fixed "today" and thresholds are part of the rules.
    // A customer who said they are GST-registered may have GST-only products in their bundle, so Udyam alone won't do.
    const requireGst = lead.answers.hasGstin === true;
    result = await validateKyc({ applicantId: lead.id, files, requireGst }, { config: DEFAULT_CONFIG });
  } catch (err) {
    if (err instanceof KycConfigError) throw new ApiError(500, 'kyc_unavailable', 'Business verification is unavailable right now.');
    throw err;
  }

  const check = await saveKycCheck(lead.id, user.id, result.decision, result.findings);
  if (result.decision === 'APPROVE') {
    // Re-read so a concurrent attempt or a staff change doesn't move the lead twice.
    const fresh = await getLead(lead.id);
    if (fresh?.stage === STAGE_AFTER_QUOTE && fresh.status === 'open') await setStage(lead.id, KYC_STAGE_DONE, null);
  }
  return NextResponse.json(check);
});
