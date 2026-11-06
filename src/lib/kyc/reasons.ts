import type { DocType, Finding, Severity } from './types';
import type { KycConfig } from './config';

interface ReasonDef {
  severity: Severity;
  message: string;
}

/** Every reason code the validator can emit. Messages are shown to reviewers and applicants. */
export const REASONS = {
  // completeness
  DOC_MISSING_SIGNATORY_ID: { severity: 'REJECT', message: 'Authorised signatory ID is missing.' },
  DOC_MISSING_ADDRESS_PROOF: { severity: 'REJECT', message: 'Address proof is missing.' },
  NO_BUSINESS_PROOF: { severity: 'REJECT', message: 'Neither a GST certificate nor a Udyam certificate was provided.' },
  DOC_UNREADABLE: { severity: 'REJECT', message: 'Nothing could be read from this document.' },
  DOC_TYPE_MISMATCH: { severity: 'REVIEW', message: 'The uploaded image is not the expected document type.' },
  UDYAM_ABSENT: { severity: 'INFO', message: 'No Udyam certificate provided; Udyam checks skipped.' },
  GST_ABSENT_PAN_UNVERIFIABLE: { severity: 'INFO', message: 'No GST certificate provided; PAN and constitution cannot be verified.' },
  // fields
  FIELD_MISSING: { severity: 'REVIEW', message: 'A required field is empty or unreadable.' },
  GSTIN_MISSING: { severity: 'REVIEW', message: 'GSTIN is empty or unreadable.' },
  UDYAM_NUMBER_MISSING: { severity: 'REVIEW', message: 'Udyam registration number is empty or unreadable.' },
  LOW_OCR_CONFIDENCE: { severity: 'REVIEW', message: 'A key field was read with low OCR confidence.' },
  OCR_CORRECTED: { severity: 'INFO', message: 'An OCR misread was corrected.' },
  // format
  GSTIN_FORMAT_INVALID: { severity: 'REJECT', message: 'GSTIN does not have the 15-character GSTIN structure.' },
  GSTIN_STATE_CODE_INVALID: { severity: 'REJECT', message: 'GSTIN starts with an unknown state code.' },
  GSTIN_CHECKSUM_INVALID: { severity: 'REJECT', message: 'GSTIN check digit is invalid.' },
  UDYAM_FORMAT_INVALID: { severity: 'REJECT', message: 'Udyam number does not match UDYAM-XX-00-0000000.' },
  // registry (government-source verification)
  GST_NOT_VERIFIED: { severity: 'REJECT', message: 'The GST certificate could not be verified against the GST registry.' },
  GSTIN_NOT_FOUND: { severity: 'REJECT', message: 'GSTIN is not in the GST registry.' },
  GST_STATUS_CANCELLED: { severity: 'REJECT', message: 'GST registration is cancelled.' },
  GST_STATUS_SUSPENDED: { severity: 'REVIEW', message: 'GST registration is suspended.' },
  GST_STATUS_UNKNOWN: { severity: 'REVIEW', message: 'GST registration has an unrecognised status.' },
  GST_CERT_MISMATCH: { severity: 'REVIEW', message: 'GST certificate value differs from the GST registry.' },
  UDYAM_NOT_VERIFIED: { severity: 'REJECT', message: 'The Udyam certificate could not be verified against the Udyam registry.' },
  UDYAM_NOT_FOUND: { severity: 'REJECT', message: 'Udyam number is not in the Udyam registry.' },
  UDYAM_CERT_MISMATCH: {
    severity: 'REVIEW',
    message: 'Udyam certificate value differs from the Udyam registry; ask for a freshly downloaded certificate.',
  },
  UDYAM_REG_DATE_DIFFERS: {
    severity: 'INFO',
    message: 'Date of registration on the Udyam certificate differs from the Udyam registry; the registry value is used.',
  },
  UDYAM_ACTIVITY_UPDATED: {
    severity: 'INFO',
    message: 'Major activity on the certificate differs from the Udyam registry (it can be updated after printing); the registry value is used.',
  },
  // consistency
  NAME_MISMATCH_UDYAM: { severity: 'REVIEW', message: 'Business name on GST and Udyam do not match.' },
  NAME_MISMATCH_ADDR_PROOF: { severity: 'REVIEW', message: 'Name on the address proof does not match the business.' },
  STATE_MISMATCH: { severity: 'REVIEW', message: 'State differs between sources.' },
  ADDRESS_MISMATCH_PPOB: { severity: 'REVIEW', message: 'Address proof differs from the registered place of business.' },
  CITY_MISMATCH_UDYAM: { severity: 'REVIEW', message: 'City on GST and Udyam do not match.' },
  PROPRIETOR_NAME_MISMATCH: { severity: 'REVIEW', message: "Proprietor's name does not match the signatory." },
  // dates
  DATE_IN_FUTURE: { severity: 'REJECT', message: 'A document date is in the future.' },
  ADDR_PROOF_STALE: { severity: 'REVIEW', message: 'Address proof is older than 90 days; ask for a recent one.' },
  SIGNATORY_ID_EXPIRED: { severity: 'REJECT', message: 'Signatory ID has expired.' },
  // signatory
  SIGNATORY_NAME_MISSING: { severity: 'REVIEW', message: 'Signatory name is missing.' },
  SIGNATORY_BUSINESS_MISMATCH: { severity: 'REVIEW', message: 'Signatory ID is issued for a different business.' },
  // engine
  INTERNAL_RULE_ERROR: { severity: 'REVIEW', message: 'A check failed to run; manual review required.' },
} as const satisfies Record<string, ReasonDef>;

export type ReasonCode = keyof typeof REASONS;

export interface FindingExtras {
  doc?: DocType;
  field?: string;
  message?: string;
  expected?: string | null;
  actual?: string | null;
  score?: number;
}

export function makeFinding(code: ReasonCode, config: KycConfig, extras: FindingExtras = {}): Finding {
  const def = REASONS[code];
  const f: Finding = {
    code,
    severity: config.severityOverrides[code] ?? def.severity,
    message: extras.message ?? def.message,
  };
  if (extras.doc) f.doc = extras.doc;
  if (extras.field) f.field = extras.field;
  if (extras.expected != null) f.expected = extras.expected;
  if (extras.actual != null) f.actual = extras.actual;
  if (extras.score != null) f.score = Math.round(extras.score * 1000) / 1000;
  return f;
}
