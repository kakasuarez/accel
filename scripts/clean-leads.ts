/**
 * Writes training_leads.csv from smb_leads.csv, keeping only the columns the model reads.
 * The output has no names, GSTINs or Udyam numbers, so it's safe to commit and deploy.
 * Run `npm run clean-leads` whenever smb_leads.csv changes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { TRAINING_COLUMNS } from "../src/lib/recommender/leads";

const root = resolve(import.meta.dirname, "..");
const rows: Record<string, string>[] = parse(readFileSync(resolve(root, "smb_leads.csv"), "utf8"), { bom: true, columns: true, record_delimiter: ["\r\n", "\n", "\r"], skip_empty_lines: true });
const quote = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
const lines = [TRAINING_COLUMNS.join(","), ...rows.map((row) => TRAINING_COLUMNS.map((column) => quote(row[column] ?? "")).join(","))];
writeFileSync(resolve(root, "training_leads.csv"), `${lines.join("\n")}\n`);
console.log(`Wrote ${rows.length} leads with ${TRAINING_COLUMNS.length} columns to training_leads.csv`);
