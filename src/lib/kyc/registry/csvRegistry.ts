import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import type { GstRecord, GstRegistry, UdyamRecord, UdyamRegistry } from '../types';

export class KycConfigError extends Error {}

export const DEFAULT_REGISTRY_DIR = path.join(process.cwd(), 'data', 'registry');

function readCsv(file: string): Record<string, string>[] {
  if (!fs.existsSync(file)) throw new KycConfigError(`KYC registry file not found: ${file}`);
  return parse(fs.readFileSync(file, 'utf8'), { columns: true, skip_empty_lines: true, trim: true, bom: true });
}

function requireColumns(rows: Record<string, string>[], cols: string[], file: string) {
  const missing = cols.filter((c) => rows.length && !(c in rows[0]));
  if (missing.length) throw new KycConfigError(`${file} is missing columns: ${missing.join(', ')}`);
}

/** GST registry backed by `gstin.csv` (columns as in mock_gstin_registry.csv). */
export class CsvGstRegistry implements GstRegistry {
  private readonly byGstin: Map<string, GstRecord>;

  constructor(file = path.join(DEFAULT_REGISTRY_DIR, 'gstin.csv')) {
    const rows = readCsv(file);
    requireColumns(rows, ['gstin', 'legal_name', 'trade_name', 'constitution', 'principal_place_of_business', 'state', 'registration_date', 'status'], file);
    this.byGstin = new Map(
      rows.map((r) => [
        r.gstin.toUpperCase(),
        {
          gstin: r.gstin.toUpperCase(),
          legalName: r.legal_name,
          tradeName: r.trade_name,
          constitution: r.constitution,
          principalPlaceOfBusiness: r.principal_place_of_business,
          state: r.state,
          registrationDate: r.registration_date,
          status: r.status,
        },
      ]),
    );
  }

  get(gstin: string): GstRecord | undefined {
    return this.byGstin.get(gstin.toUpperCase());
  }

  get size() {
    return this.byGstin.size;
  }
}

/** Udyam registry backed by `udyam.csv` (columns as in mock_udyam_registry.csv). */
export class CsvUdyamRegistry implements UdyamRegistry {
  private readonly byNumber: Map<string, UdyamRecord>;

  constructor(file = path.join(DEFAULT_REGISTRY_DIR, 'udyam.csv')) {
    const rows = readCsv(file);
    requireColumns(rows, ['udyam_number', 'enterprise_name', 'enterprise_type', 'major_activity', 'nic_description', 'state', 'city', 'date_of_registration'], file);
    this.byNumber = new Map(
      rows.map((r) => [
        r.udyam_number.toUpperCase(),
        {
          udyamNumber: r.udyam_number.toUpperCase(),
          enterpriseName: r.enterprise_name,
          enterpriseType: r.enterprise_type,
          majorActivity: r.major_activity,
          nicDescription: r.nic_description,
          state: r.state,
          city: r.city,
          dateOfRegistration: r.date_of_registration,
        },
      ]),
    );
  }

  get(udyamNumber: string): UdyamRecord | undefined {
    return this.byNumber.get(udyamNumber.toUpperCase());
  }

  get size() {
    return this.byNumber.size;
  }
}

const g = globalThis as unknown as { __kycRegistries?: { gst: CsvGstRegistry; udyam: CsvUdyamRegistry } };

/** Load both registries once per process (cached on globalThis so Next.js dev reloads reuse them). */
export function defaultRegistries() {
  g.__kycRegistries ??= { gst: new CsvGstRegistry(), udyam: new CsvUdyamRegistry() };
  return g.__kycRegistries;
}
