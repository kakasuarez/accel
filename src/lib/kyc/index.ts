import 'server-only';

/**
 * Business KYC validator (server only).
 *
 *   const result = await validateKyc({ applicantId, files: { gst_certificate, udyam_certificate, signatory_id, address_proof } });
 *
 * See the LLD for the rules; reason codes are listed in ./reasons.ts.
 */
export { validateKyc, extractDocuments, type KycOptions } from './pipeline';
export { evaluateBundle, type EvaluateOptions } from './evaluate';
export { DEFAULT_CONFIG, type KycConfig } from './config';
export { REASONS, type ReasonCode } from './reasons';
export { CsvGstRegistry, CsvUdyamRegistry, KycConfigError, defaultRegistries } from './registry/csvRegistry';
export { DOC_TYPES } from './types';
export type * from './types';
