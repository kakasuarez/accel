import type { DocType } from '../types';

export interface FieldSpec {
  key: string;
  /** Label texts that introduce this field (matched fuzzily after normalization). */
  aliases: string[];
  /** Text of a label's second line, e.g. "place of business" under "Address of principal". Never starts a field. */
  continuations?: string[];
  kind: 'text' | 'date' | 'gstin' | 'udyam';
}

/**
 * Label vocabulary per document type. Includes the wording used by the official GST REG-06 and Udyam
 * certificates and common Indian utility bills, so layouts other than the sample specimens still map.
 */
export const DOC_FIELDS: Record<DocType, FieldSpec[]> = {
  gst_certificate: [
    { key: 'gstin', kind: 'gstin', aliases: ['gstin', 'registration number', 'gstin uin', 'gst number', 'gst no'] },
    { key: 'legalName', kind: 'text', aliases: ['legal name', 'legal name of business', 'legal name of the business'] },
    { key: 'tradeName', kind: 'text', aliases: ['trade name', 'trade name if any'] },
    { key: 'constitution', kind: 'text', aliases: ['constitution', 'constitution of business'] },
    {
      key: 'address',
      kind: 'text',
      aliases: ['address of principal place of business', 'address of principal', 'principal place of business', 'address'],
      continuations: ['place of business', 'principal place of business'],
    },
    { key: 'dateOfLiability', kind: 'date', aliases: ['date of liability', 'date of registration', 'registration date'] },
    { key: 'registrationType', kind: 'text', aliases: ['type of registration', 'registration type'] },
  ],
  udyam_certificate: [
    {
      key: 'udyamNumber',
      kind: 'udyam',
      aliases: ['udyam reg number', 'udyam registration number', 'udyam number', 'udyam reg no', 'registration number'],
    },
    { key: 'enterpriseName', kind: 'text', aliases: ['enterprise name', 'name of enterprise', 'name of the enterprise'] },
    { key: 'majorActivity', kind: 'text', aliases: ['major activity', 'activity'] },
    { key: 'city', kind: 'text', aliases: ['city', 'city town', 'district'] },
    { key: 'state', kind: 'text', aliases: ['state'] },
    { key: 'dateOfRegistration', kind: 'date', aliases: ['date of registration', 'date of udyam registration', 'registration date'] },
  ],
  signatory_id: [
    { key: 'name', kind: 'text', aliases: ['name', 'name of signatory', 'signatory name'] },
    { key: 'designation', kind: 'text', aliases: ['designation', 'role'] },
    { key: 'forBusiness', kind: 'text', aliases: ['for business', 'business name', 'on behalf of', 'organisation', 'organization'] },
    { key: 'idNumber', kind: 'text', aliases: ['id no', 'id number', 'card no', 'card number'] },
    { key: 'validTill', kind: 'date', aliases: ['valid till', 'valid upto', 'valid up to', 'expiry date', 'date of expiry', 'valid until'] },
  ],
  address_proof: [
    { key: 'accountNo', kind: 'text', aliases: ['consumer no', 'consumer number', 'account no', 'account number', 'customer id', 'ca no', 'connection no'] },
    { key: 'billedTo', kind: 'text', aliases: ['billed to', 'consumer name', 'customer name', 'name', 'account holder', 'bill to'] },
    {
      key: 'address',
      kind: 'text',
      aliases: ['supply address', 'service address', 'installation address', 'premises address', 'billing address', 'address'],
    },
    {
      key: 'documentDate',
      kind: 'date',
      aliases: ['bill date', 'statement date', 'date of issue', 'issue date', 'invoice date', 'bill issue date', 'date'],
    },
    // Read so they are recognised as labels (and end the previous field), but not used.
    { key: '_units', kind: 'text', aliases: ['units consumed', 'units'] },
    { key: '_amount', kind: 'text', aliases: ['amount due', 'amount payable', 'total amount', 'net amount'] },
    { key: '_dueDate', kind: 'date', aliases: ['due date', 'pay by'] },
  ],
};

/** Title phrases per document type. Address proofs accept any of the usual utility/statement documents. */
export const DOC_TITLES: Record<DocType, string[]> = {
  gst_certificate: ['gst registration certificate', 'registration certificate form gst reg 06', 'goods and services tax'],
  udyam_certificate: ['udyam registration certificate', 'udyam registration'],
  signatory_id: ['authorised signatory id', 'authorized signatory id', 'authorised signatory', 'authorized signatory'],
  address_proof: [
    'electricity bill',
    'water bill',
    'gas bill',
    'piped gas bill',
    'telephone bill',
    'landline bill',
    'broadband bill',
    'postpaid bill',
    'utility bill',
    'property tax receipt',
    'bank statement',
    'rent agreement',
  ],
};

/** Field keys starting with "_" are recognised labels whose values are discarded. */
export const isDiscarded = (key: string) => key.startsWith('_');
