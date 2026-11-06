import type { IsoDate, Severity } from './types';
import type { ReasonCode } from './reasons';

export interface KycConfig {
  /** "Today" for all date checks (problem statement D4). */
  today: IsoDate;
  addrProofMaxAgeDays: number;
  /** Fuzzy score (0–1) for names compared across documents. */
  nameMatchMin: number;
  /** Fuzzy score for certificate values vs the registry record (stricter: tamper signal). */
  registryFieldMatchMin: number;
  /** Fuzzy score for the street part of two addresses. */
  addressStreetMatchMin: number;
  /** Tesseract confidence (0–100) below which a key field is flagged. */
  ocrLowConfidence: number;
  /** Laplacian variance below which an image is treated as blurry and enhanced first. */
  blurLaplacianVarMin: number;
  ocrTimeoutMs: number;
  maxFileBytes: number;
  severityOverrides: Partial<Record<ReasonCode, Severity>>;
}

export const DEFAULT_CONFIG: KycConfig = {
  today: '2026-07-15',
  addrProofMaxAgeDays: 90,
  nameMatchMin: 0.85,
  registryFieldMatchMin: 0.92,
  addressStreetMatchMin: 0.8,
  ocrLowConfidence: 60,
  blurLaplacianVarMin: 100,
  ocrTimeoutMs: 20_000,
  maxFileBytes: 5 * 1024 * 1024,
  severityOverrides: {},
};

export function resolveConfig(partial?: Partial<KycConfig>): KycConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    severityOverrides: { ...DEFAULT_CONFIG.severityOverrides, ...partial?.severityOverrides },
  };
}
