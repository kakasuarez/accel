import { currentUser } from '@/lib/auth/session';
import { KycConfigError, validateKyc, type DocType } from '@/lib/kyc';
import { readKycUpload, UploadError } from '@/lib/kyc/upload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bad = (error: string, status = 400) => Response.json({ error }, { status });

/**
 * POST /api/kyc/validate (multipart/form-data). Staff only: a dry run that stores nothing and moves no lead.
 * Customers go through POST /api/leads/:id/kyc.
 * Parts: gst_certificate, udyam_certificate, signatory_id, address_proof (images), applicantId (optional).
 * Files are processed in memory only and never written to disk.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return bad('Please sign in.', 401);
  if (!user.isAdmin) return bad("You don't have access to this.", 403);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad('Expected multipart/form-data.');
  }

  let files: Partial<Record<DocType, Buffer>>;
  try {
    files = await readKycUpload(form);
  } catch (err) {
    if (err instanceof UploadError) return bad(err.message);
    throw err;
  }

  const applicantId = form.get('applicantId');
  try {
    const result = await validateKyc({ applicantId: typeof applicantId === 'string' ? applicantId : undefined, files });
    return Response.json(result);
  } catch (err) {
    if (err instanceof KycConfigError) return bad('KYC service is not configured correctly.', 500);
    throw err;
  }
}
