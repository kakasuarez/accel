import { parse } from "csv-parse/sync";
import type { Catalogue, Product, ProductRole } from "./types";

const COLUMNS = [
  "product_id", "category", "product_name", "description", "unit",
  "price_min_inr_per_month", "price_max_inr_per_month", "one_time_setup_inr", "min_contract_months",
  "available_city_tiers", "min_employees", "min_sites", "requires_gstin", "requires_one_of",
  "typical_install_days", "target_segments",
];

export class CatalogueError extends Error {
  override name = "CatalogueError";
}

/**
 * What a product does in a bundle, from its columns alone, so a new row needs no code change.
 * A link is per-site connectivity that stands alone; backup and SD-WAN need a link, so they're add-ons.
 */
function roleOf(row: Record<string, string>): ProductRole {
  if (row.unit === "per line") return "mobile";
  return row.category === "Connectivity" && row.unit === "per site" && !row.requires_one_of ? "link" : "add_on";
}

function speedOf(text: string): number | null {
  const match = /(\d+(?:\.\d+)?)\s*(Gbps|Mbps)/i.exec(text);
  if (!match) return null;
  return Number(match[1]) * (match[2]!.toLowerCase() === "gbps" ? 1000 : 1);
}

export function parseCatalogue(csv: string): Catalogue {
  let rows: Record<string, string>[];
  try {
    // Spreadsheets and text editors mix line endings, and Excel adds a byte-order mark.
    rows = parse(csv, { bom: true, columns: true, record_delimiter: ["\r\n", "\n", "\r"], skip_empty_lines: true, trim: true });
  } catch (error) {
    throw new CatalogueError(`Product catalogue isn't valid CSV: ${(error as Error).message}`);
  }
  if (rows.length === 0) throw new CatalogueError("Product catalogue has no products.");
  const missing = COLUMNS.filter((column) => !(column in rows[0]!));
  if (missing.length > 0) throw new CatalogueError(`Product catalogue is missing columns: ${missing.join(", ")}`);

  const products = rows.map((row, index): Product => {
    const where = `${row.product_id || `row ${index + 2}`}`;
    const number = (column: string) => {
      const value = Number(row[column]);
      if (row[column] === "" || !Number.isFinite(value) || value < 0) {
        throw new CatalogueError(`${where}: ${column} must be a number, got "${row[column]}"`);
      }
      return value;
    };
    const flag = row.requires_gstin;
    if (flag !== "Y" && flag !== "N") throw new CatalogueError(`${where}: requires_gstin must be Y or N, got "${flag}"`);
    const list = (column: string, separator: string) => row[column]!.split(separator).map((s) => s.trim()).filter(Boolean);
    const product: Product = {
      id: row.product_id!,
      category: row.category!,
      name: row.product_name!,
      description: row.description!,
      unit: row.unit!,
      priceMin: number("price_min_inr_per_month"),
      priceMax: number("price_max_inr_per_month"),
      setupFee: number("one_time_setup_inr"),
      minContractMonths: number("min_contract_months"),
      cityTiers: list("available_city_tiers", ";").map(Number),
      minEmployees: number("min_employees"),
      minSites: number("min_sites"),
      requiresGstin: flag === "Y",
      requiresOneOf: list("requires_one_of", "|"),
      installDays: number("typical_install_days"),
      targetSegments: list("target_segments", ";"),
      role: roleOf(row),
      // Wireless products are described as being "for sites without fibre".
      needsFibre: /fibre/i.test(`${row.product_name} ${row.description}`) && !/without fibre/i.test(row.description!),
      speedMbps: speedOf(`${row.description} ${row.product_name}`),
    };
    if (!product.id) throw new CatalogueError(`Row ${index + 2}: product_id is empty.`);
    if (product.priceMin > product.priceMax) throw new CatalogueError(`${where}: minimum price is above maximum price.`);
    return product;
  });

  const byId = new Map(products.map((product) => [product.id, product]));
  if (byId.size !== products.length) throw new CatalogueError("Product catalogue has duplicate product ids.");
  return { products, byId };
}
