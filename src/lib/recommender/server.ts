import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseCatalogue } from "./catalogue";
import { createRecommender, type Recommender } from "./engine";
import { parseLeads } from "./leads";
import type { ModelOptions } from "./model/scorer";

/** Reads both CSVs fresh and trains. A bad catalogue throws here, so the site fails loudly at startup. */
export function loadRecommender(dataDir = process.env.ACCEL_DATA_DIR ?? process.cwd(), model?: ModelOptions): Recommender {
  const read = (file: string) => readFileSync(/* turbopackIgnore: true */ resolve(dataDir, file), "utf8");
  return createRecommender(parseCatalogue(read("product_catalogue.csv")), parseLeads(read("training_leads.csv")), model);
}

// On globalThis because Next.js can load this module more than once in a single process.
const cache = globalThis as { __accelRecommender?: Recommender };

/** Server-side only. Built once per cold start. */
export function getRecommender(): Recommender {
  cache.__accelRecommender ??= loadRecommender();
  return cache.__accelRecommender;
}
