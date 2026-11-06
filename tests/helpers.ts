import type {
  AddressProofFields,
  ExtractedBundle,
  ExtractedDoc,
  Field,
  GstCertFields,
  GstRecord,
  GstRegistry,
  SignatoryFields,
  UdyamCertFields,
  UdyamRecord,
  UdyamRegistry,
} from '../src/lib/kyc/types';

export const f = (value: string | null, confidence = 95): Field => ({ value, raw: value, confidence });

const quality = { skewDeg: 0, blurScore: 500, enhanced: false, meanConfidence: 95 };

export const GST_REC: GstRecord = {
  gstin: '37IHKXV5167L1ZS',
  legalName: 'Neha Kaur (Prop. Vindhya Tours & Travels)',
  tradeName: 'Vindhya Tours & Travels',
  constitution: 'Proprietorship',
  principalPlaceOfBusiness: 'Shop/Unit 1, Tech Park Road, Visakhapatnam, Andhra Pradesh - 118383',
  state: 'Andhra Pradesh',
  registrationDate: '2025-06-07',
  status: 'Active',
};

export const UDYAM_REC: UdyamRecord = {
  udyamNumber: 'UDYAM-AP-00-1234567',
  enterpriseName: 'Vindhya Tours & Travels',
  enterpriseType: 'Micro',
  majorActivity: 'Services',
  nicDescription: 'Travel agency',
  state: 'Andhra Pradesh',
  city: 'Visakhapatnam',
  dateOfRegistration: '2024-03-24',
};

export function registries(gst: GstRecord[] = [GST_REC], udyam: UdyamRecord[] = [UDYAM_REC]) {
  const g = new Map(gst.map((r) => [r.gstin, r]));
  const u = new Map(udyam.map((r) => [r.udyamNumber, r]));
  const gstRegistry: GstRegistry = { get: (k) => g.get(k) };
  const udyamRegistry: UdyamRegistry = { get: (k) => u.get(k) };
  return { gstRegistry, udyamRegistry };
}

type Over<T> = Partial<Record<keyof T, string | null>>;

function doc<F>(slot: ExtractedDoc<F>['slot'], fields: F, extra: Partial<ExtractedDoc<F>> = {}): ExtractedDoc<F> {
  return { slot, detectedType: slot, title: null, readable: true, fields, quality, ...extra };
}

export function gstDoc(o: Over<GstCertFields> = {}, extra: Partial<ExtractedDoc<GstCertFields>> = {}) {
  const v = (k: keyof GstCertFields, d: string | null) => f(k in o ? o[k]! : d);
  return doc<GstCertFields>(
    'gst_certificate',
    {
      gstin: v('gstin', GST_REC.gstin),
      legalName: v('legalName', GST_REC.legalName),
      tradeName: v('tradeName', GST_REC.tradeName),
      constitution: v('constitution', GST_REC.constitution),
      address: v('address', GST_REC.principalPlaceOfBusiness),
      dateOfLiability: v('dateOfLiability', GST_REC.registrationDate),
      registrationType: v('registrationType', 'Regular'),
    },
    extra,
  );
}

export function udyamDoc(o: Over<UdyamCertFields> = {}, extra: Partial<ExtractedDoc<UdyamCertFields>> = {}) {
  const v = (k: keyof UdyamCertFields, d: string | null) => f(k in o ? o[k]! : d);
  return doc<UdyamCertFields>(
    'udyam_certificate',
    {
      udyamNumber: v('udyamNumber', UDYAM_REC.udyamNumber),
      enterpriseName: v('enterpriseName', UDYAM_REC.enterpriseName),
      majorActivity: v('majorActivity', UDYAM_REC.majorActivity),
      city: v('city', UDYAM_REC.city),
      state: v('state', UDYAM_REC.state),
      dateOfRegistration: v('dateOfRegistration', UDYAM_REC.dateOfRegistration),
    },
    extra,
  );
}

export function signatoryDoc(o: Over<SignatoryFields> = {}, extra: Partial<ExtractedDoc<SignatoryFields>> = {}) {
  const v = (k: keyof SignatoryFields, d: string | null) => f(k in o ? o[k]! : d);
  return doc<SignatoryFields>(
    'signatory_id',
    {
      name: v('name', 'Neha Kaur'),
      designation: v('designation', 'Office admin'),
      forBusiness: v('forBusiness', 'Vindhya Tours & Travels'),
      idNumber: v('idNumber', 'SYN-ID-346190'),
      validTill: v('validTill', '2028-03-26'),
    },
    extra,
  );
}

export function addressDoc(o: Over<AddressProofFields> = {}, extra: Partial<ExtractedDoc<AddressProofFields>> = {}) {
  const v = (k: keyof AddressProofFields, d: string | null) => f(k in o ? o[k]! : d);
  return doc<AddressProofFields>(
    'address_proof',
    {
      accountNo: v('accountNo', '9485717625'),
      billedTo: v('billedTo', 'Vindhya Tours & Travels'),
      address: v('address', GST_REC.principalPlaceOfBusiness),
      documentDate: v('documentDate', '2026-06-26'),
    },
    extra,
  );
}

/** A complete, consistent applicant that should be approved. */
export function goodBundle(): ExtractedBundle {
  return { gst: gstDoc(), udyam: udyamDoc(), signatory: signatoryDoc(), addressProof: addressDoc() };
}
