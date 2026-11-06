import type { KycConfig } from '../config';
import { makeFinding, type FindingExtras, type ReasonCode } from '../reasons';
import type {
  DocType,
  ExtractedBundle,
  ExtractedDoc,
  Field,
  FieldsByDoc,
  Finding,
  GstRecord,
  GstRegistry,
  IsoDate,
  UdyamRecord,
  UdyamRegistry,
} from '../types';
import { parseAddress, type ParsedAddress } from '../util/address';
import { stateByGstCode, stateByName, stateByUdyamCode } from '../util/states';

/** Mutable state shared by the rules of one evaluation. Earlier rules fill it for later ones. */
export interface RuleCtx {
  bundle: ExtractedBundle;
  config: KycConfig;
  today: IsoDate;
  gstRegistry: GstRegistry;
  udyamRegistry: UdyamRegistry;
  /** Well-formed GSTIN that passed the checksum (after any OCR correction). Set by format.gstin. */
  gstin?: string;
  /** Well-formed Udyam number. Set by format.udyam. */
  udyamNumber?: string;
  /** Registry records; set only when the government-source lookup succeeded. */
  gstRec?: GstRecord;
  udyamRec?: UdyamRecord;
}

export type RuleOutcome = Finding[] | { skip: string };

export interface Rule {
  id: string;
  run(ctx: RuleCtx): RuleOutcome;
}

export const finding = (ctx: RuleCtx, code: ReasonCode, extras?: FindingExtras) => makeFinding(code, ctx.config, extras);

// ----------------------------------------------------------- document access

const SLOT_KEY = {
  gst_certificate: 'gst',
  udyam_certificate: 'udyam',
  signatory_id: 'signatory',
  address_proof: 'addressProof',
} as const satisfies Record<DocType, keyof ExtractedBundle>;

export function docIn<T extends DocType>(bundle: ExtractedBundle, slot: T): ExtractedDoc<FieldsByDoc[T]> | undefined {
  return bundle[SLOT_KEY[slot]] as ExtractedDoc<FieldsByDoc[T]> | undefined;
}

/** The slot holds a document that is (or may be) the right type. A different, recognised document type does not count. */
export function submitted(ctx: RuleCtx, slot: DocType): boolean {
  const d = docIn(ctx.bundle, slot);
  return !!d && (d.detectedType === slot || d.detectedType === 'unknown');
}

/** Submitted and something could be read from it. */
export function usable<T extends DocType>(ctx: RuleCtx, slot: T): ExtractedDoc<FieldsByDoc[T]> | undefined {
  const d = docIn(ctx.bundle, slot);
  return d && submitted(ctx, slot) && d.readable ? d : undefined;
}

export const val = <T>(f: Field<T> | undefined): T | null => f?.value ?? null;

// ----------------------------------------------------------- derived views

/** "Neha Kaur (Prop. Vindhya Tours & Travels)" → owner "Neha Kaur", business "Vindhya Tours & Travels". */
export function parseLegalName(legal: string | null | undefined): { owner: string | null; business: string | null } {
  if (!legal) return { owner: null, business: null };
  const m = legal.match(/^(.*?)\s*\(\s*Prop\.?\s*(.*?)\s*\)\s*$/i);
  if (m) return { owner: m[1].trim() || null, business: m[2].trim() || null };
  return { owner: legal.trim(), business: null };
}

export interface GstView {
  legalName: string | null;
  tradeName: string | null;
  constitution: string | null;
  address: ParsedAddress | null;
  state: string | null;
  fromRegistry: boolean;
}

export interface UdyamView {
  enterpriseName: string | null;
  city: string | null;
  state: string | null;
  fromRegistry: boolean;
}

/**
 * GST business details used by cross-document checks: the registry record when the lookup succeeded
 * (government source is authoritative), otherwise the values read from the certificate.
 */
export function gstView(ctx: RuleCtx): GstView | undefined {
  if (ctx.gstRec) {
    const r = ctx.gstRec;
    return {
      legalName: r.legalName,
      tradeName: r.tradeName,
      constitution: r.constitution,
      address: parseAddress(r.principalPlaceOfBusiness),
      state: stateByName(r.state)?.name ?? r.state,
      fromRegistry: true,
    };
  }
  const d = usable(ctx, 'gst_certificate');
  if (!d) return undefined;
  const f = d.fields;
  const address = parseAddress(val(f.address));
  const gstin = ctx.gstin ?? val(f.gstin);
  return {
    legalName: val(f.legalName),
    tradeName: val(f.tradeName),
    constitution: val(f.constitution),
    address,
    state: (gstin && stateByGstCode(gstin.slice(0, 2))?.name) || address?.state || null,
    fromRegistry: false,
  };
}

export function udyamView(ctx: RuleCtx): UdyamView | undefined {
  if (ctx.udyamRec) {
    const r = ctx.udyamRec;
    return { enterpriseName: r.enterpriseName, city: r.city, state: stateByName(r.state)?.name ?? r.state, fromRegistry: true };
  }
  const d = usable(ctx, 'udyam_certificate');
  if (!d) return undefined;
  const f = d.fields;
  const no = ctx.udyamNumber ?? val(f.udyamNumber);
  const stateText = val(f.state);
  return {
    enterpriseName: val(f.enterpriseName),
    city: val(f.city),
    state: stateByName(stateText)?.name ?? (no ? stateByUdyamCode(no.slice(6, 8))?.name : undefined) ?? stateText,
    fromRegistry: false,
  };
}

/** Names the business may legitimately appear under: trade name, legal name, the "(Prop. …)" business, or Udyam name. */
export function businessNames(ctx: RuleCtx): string[] {
  const g = gstView(ctx);
  if (g) {
    return [g.tradeName, g.legalName, parseLegalName(g.legalName).business].filter((x): x is string => !!x);
  }
  const u = udyamView(ctx);
  return u?.enterpriseName ? [u.enterpriseName] : [];
}

export const isProprietorship = (constitution: string | null | undefined) => /proprietor/i.test(constitution ?? '');
