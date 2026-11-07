import type { ReasonCode } from './reasons';

export type DocType = 'gst_certificate' | 'udyam_certificate' | 'signatory_id' | 'address_proof';
export const DOC_TYPES: readonly DocType[] = ['gst_certificate', 'udyam_certificate', 'signatory_id', 'address_proof'];

/** Calendar date as 'YYYY-MM-DD'. */
export type IsoDate = string;
export type Severity = 'REJECT' | 'REVIEW' | 'INFO';
export type Decision = 'APPROVE' | 'MANUAL_REVIEW' | 'REJECT';

export interface KycInput {
  applicantId?: string;
  files: Partial<Record<DocType, Buffer>>;
  /** The applicant said they are GST-registered, so the GST certificate is required (Udyam alone is not enough). */
  requireGst?: boolean;
}

/** One value read from a document. `value` is the normalized form, `raw` the OCR text. */
export interface Field<T = string> {
  value: T | null;
  raw: string | null;
  /** Mean OCR word confidence, 0–100. 100 for values not produced by OCR (tests, manual entry). */
  confidence: number;
  /** Set when the OCR text was corrected (character repair). */
  repaired?: boolean;
}

export interface GstCertFields {
  gstin: Field;
  legalName: Field;
  tradeName: Field;
  constitution: Field;
  address: Field;
  dateOfLiability: Field<IsoDate>;
  registrationType: Field;
}

export interface UdyamCertFields {
  udyamNumber: Field;
  enterpriseName: Field;
  majorActivity: Field;
  city: Field;
  state: Field;
  dateOfRegistration: Field<IsoDate>;
}

export interface SignatoryFields {
  name: Field;
  designation: Field;
  forBusiness: Field;
  idNumber: Field;
  validTill: Field<IsoDate>;
}

export interface AddressProofFields {
  billedTo: Field;
  address: Field;
  documentDate: Field<IsoDate>;
  accountNo: Field;
}

export interface FieldsByDoc {
  gst_certificate: GstCertFields;
  udyam_certificate: UdyamCertFields;
  signatory_id: SignatoryFields;
  address_proof: AddressProofFields;
}

export interface DocQuality {
  skewDeg: number;
  blurScore: number;
  enhanced: boolean;
  meanConfidence: number;
}

export interface ExtractedDoc<F> {
  slot: DocType;
  detectedType: DocType | 'unknown';
  /** Title-bar text, e.g. "Specimen: Electricity Bill". */
  title: string | null;
  /** For address proofs: the kind of document named in the title, e.g. "Electricity Bill". */
  proofKind?: string;
  /** false = nothing usable could be read. */
  readable: boolean;
  fields: F;
  quality: DocQuality;
}

export interface ExtractedBundle {
  gst?: ExtractedDoc<GstCertFields>;
  udyam?: ExtractedDoc<UdyamCertFields>;
  signatory?: ExtractedDoc<SignatoryFields>;
  addressProof?: ExtractedDoc<AddressProofFields>;
}

export interface Finding {
  code: ReasonCode;
  severity: Severity;
  doc?: DocType;
  field?: string;
  message: string;
  expected?: string;
  actual?: string;
  score?: number;
}

export interface CheckResult {
  ruleId: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  skippedBecause?: string;
}

export interface KycResult {
  applicantId?: string;
  decision: Decision;
  findings: Finding[];
  checks: CheckResult[];
  /** Extracted values, masked and limited to what the checks use (DPDP). */
  extracted: MaskedBundle;
  evaluatedAt: string;
  today: IsoDate;
}

export type MaskedBundle = Partial<Record<DocType, Record<string, string | null>>>;

// ---------------------------------------------------------------- registries

export interface GstRecord {
  gstin: string;
  legalName: string;
  tradeName: string;
  constitution: string;
  principalPlaceOfBusiness: string;
  state: string;
  registrationDate: IsoDate;
  status: string;
}

export interface UdyamRecord {
  udyamNumber: string;
  enterpriseName: string;
  enterpriseType: string;
  majorActivity: string;
  nicDescription: string;
  state: string;
  city: string;
  dateOfRegistration: IsoDate;
}

/** Government-source lookup. The CSV implementation can be swapped for a real API client. */
export interface GstRegistry {
  get(gstin: string): GstRecord | undefined;
}
export interface UdyamRegistry {
  get(udyamNumber: string): UdyamRecord | undefined;
}
