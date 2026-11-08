import { parse } from "csv-parse/sync";
import { CatalogueError } from "./catalogue";
import type { Segment } from "./types";

export const SENSITIVITIES = ["high", "medium", "medium_low", "low"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

/** Used for a segment that isn't listed, such as a new one. */
export const DEFAULT_SENSITIVITY: Sensitivity = "medium";

/**
 * Reads data/price_sensitivity.csv: one row per segment code (as in the catalogue's target_segments),
 * with a price_sensitivity of high, medium, medium_low or low. A bad file stops startup, like the catalogue.
 */
export function parseSensitivity(csv: string): ReadonlyMap<Segment, Sensitivity> {
  let rows: Record<string, string>[];
  try {
    rows = parse(csv, { bom: true, columns: true, record_delimiter: ["\r\n", "\n", "\r"], skip_empty_lines: true, trim: true });
  } catch (error) {
    throw new CatalogueError(`Price sensitivity file isn't valid CSV: ${(error as Error).message}`);
  }
  const bySegment = new Map<Segment, Sensitivity>();
  for (const row of rows) {
    const segment = row.segment;
    const level = row.price_sensitivity as Sensitivity;
    if (!segment) throw new CatalogueError("Price sensitivity file has a row without a segment.");
    if (!SENSITIVITIES.includes(level)) {
      throw new CatalogueError(`Price sensitivity for ${segment} must be one of ${SENSITIVITIES.join(", ")}, got "${row.price_sensitivity}"`);
    }
    bySegment.set(segment, level);
  }
  return bySegment;
}

/**
 * How many mobile lines the Budget bundle keeps, from the recommended number. Highly price-sensitive
 * businesses get the deepest cut; less sensitive ones keep every line and only move to cheaper products.
 */
export function budgetMobileLines(sensitivity: Sensitivity, recommended: number): number {
  switch (sensitivity) {
    case "high":
      return 1;
    case "medium":
      return Math.max(1, Math.ceil(recommended / 2));
    default:
      return recommended;
  }
}

/**
 * How far into a product's price range this customer is quoted: the most price-sensitive pay the minimum,
 * the least sensitive the maximum, and the two in between are a third and two thirds of the way up.
 */
const PRICE_POSITION: Record<Sensitivity, number> = { high: 0, medium: 1 / 3, medium_low: 2 / 3, low: 1 };

/** The monthly price per unit this customer is quoted, to the nearest rupee. */
export function quotedPrice(product: { priceMin: number; priceMax: number }, sensitivity: Sensitivity): number {
  return Math.round(product.priceMin + PRICE_POSITION[sensitivity] * (product.priceMax - product.priceMin));
}
