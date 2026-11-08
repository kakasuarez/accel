import 'server-only';
import sharp from 'sharp';
import { DEFAULT_CONFIG } from './config';
import { DOC_TYPES, type DocType } from './types';

const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'webp']);

export class UploadError extends Error {}

/** The form part the KYC page sends once the customer ticks the consent box. */
export const CONSENT_FIELD = 'consent';

/** True only when the customer explicitly agreed to the document check (the part is exactly "yes"). */
export const hasKycConsent = (form: FormData) => form.get(CONSENT_FIELD) === 'yes';

/**
 * Reads the document parts of a KYC multipart upload into memory. Only the format and size are checked here;
 * which documents are present is left to the engine's completeness rule, so it records the reason code.
 */
export async function readKycUpload(form: FormData): Promise<Partial<Record<DocType, Buffer>>> {
  const files: Partial<Record<DocType, Buffer>> = {};
  for (const slot of DOC_TYPES) {
    const part = form.get(slot);
    if (part == null || part === '') continue;
    if (typeof part === 'string') throw new UploadError(`"${slot}" must be a file.`);
    if (part.size === 0) continue;
    if (part.size > DEFAULT_CONFIG.maxFileBytes) throw new UploadError(`"${slot}" is larger than ${DEFAULT_CONFIG.maxFileBytes / 1024 / 1024} MB.`);
    const buf = Buffer.from(await part.arrayBuffer());
    // Check the real content type, not the filename or the client-declared MIME type.
    const format = await sharp(buf)
      .metadata()
      .then((m) => m.format)
      .catch(() => undefined);
    if (!format || !ACCEPTED_FORMATS.has(format)) throw new UploadError(`"${slot}" must be a PNG, JPEG or WebP image.`);
    files[slot] = buf;
  }
  return files;
}
