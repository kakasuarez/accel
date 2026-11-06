import { parse } from "csv-parse/sync";
import type { Lead, Segment } from "./types";

export const FUNNEL_STAGES = ["Lead", "Contacted", "Needs assessed", "Quote accepted", "KYC complete", "Activated"];

/** The only columns parseLeads reads. Anything personal stays out of the deployed training file. */
export const TRAINING_COLUMNS = [
  "lead_id",
  "created_date",
  "business_type",
  "segment",
  "city",
  "city_tier",
  "employee_count",
  "num_sites",
  "has_gstin",
  "has_udyam",
  "current_internet",
  "monthly_telecom_spend_inr",
  "stage_reached",
  "outcome",
  "bundle_products",
  "monthly_bundle_value_inr",
  "churned_within_6_months",
] as const;

/** The leads spell segments out; the catalogue uses these codes in `target_segments`. */
const SEGMENT_CODES: Record<string, Segment> = {
  "Micro retail & services": "micro",
  "Professional offices": "prof",
  "Small multi-site businesses": "multi",
  "Small manufacturers": "mfg",
};

/** Every lead, won and lost. Bundles may mention products since removed from the catalogue. */
export function parseLeads(csv: string): Lead[] {
  const rows: Record<string, string>[] = parse(csv, { bom: true, columns: true, record_delimiter: ["\r\n", "\n", "\r"], skip_empty_lines: true });
  return rows.map((r) => {
    const segment = SEGMENT_CODES[r.segment!];
    if (!segment) throw new Error(`Unknown segment "${r.segment}" on lead ${r.lead_id}`);
    const bundle = new Map<string, number>();
    for (const item of r.bundle_products ? r.bundle_products.split(";") : []) {
      const [id, quantity] = item.split("x");
      bundle.set(id!, Number(quantity));
    }
    return {
      id: r.lead_id!,
      created: r.created_date!,
      city: r.city!,
      segment,
      segmentLabel: r.segment!,
      activated: r.outcome === "Activated",
      stage: FUNNEL_STAGES.indexOf(r.stage_reached!),
      hasUdyam: r.has_udyam === "Y",
      bundle,
      monthlyValue: Number(r.monthly_bundle_value_inr),
      churned: r.churned_within_6_months === "Y",
      // Only fields a prospect can tell us before buying: nothing post-sale.
      profile: {
        businessType: r.business_type!,
        employees: Number(r.employee_count),
        sites: Number(r.num_sites),
        cityTier: Number(r.city_tier),
        hasGstin: r.has_gstin === "Y",
        currentInternet: r.current_internet!,
        monthlyTelecomSpend: Number(r.monthly_telecom_spend_inr),
      },
    };
  });
}
