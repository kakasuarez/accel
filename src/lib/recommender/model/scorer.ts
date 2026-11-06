import { eligibilityBlock } from "../eligibility";
import { rate, type Insights } from "../insights";
import type { BusinessProfile, Catalogue, Lead, ProductId, Segment } from "../types";
import { buildFeatureSpace } from "./features";
import { predictForest, trainForest, type Forest } from "./forest";

/** "How likely is this customer to buy this product?" Compared across a customer's allowed products. */
export type Scorer = (id: ProductId, profile: BusinessProfile, segment: Segment) => number;

export type ModelKind = "forest" | "frequency";

/**
 * Chosen by cross-validation over 5 to 45. Bootstrap rows repeat, so a smaller leaf can be a
 * handful of real customers: on data this noisy, that scored below the baseline on add-ons.
 */
const MIN_LEAF = 20;

export interface ModelOptions {
  kind?: ModelKind;
  trees?: number;
  seed?: number;
  minLeaf?: number;
}

/** The baseline to beat: a segment's bought rate, the same for every customer in it. */
export function frequencyScorer(insights: Insights): Scorer {
  return (id, _, segment) => {
    const support = insights.support(segment, id);
    return support ? rate(support) : 0;
  };
}

/**
 * One forest per product, trained only on leads who could have bought it, so a past sale
 * the catalogue forbids is never learned. A product nobody has bought scores 0 until it sells.
 */
export function forestScorer(catalogue: Catalogue, leads: readonly Lead[], options: ModelOptions): Scorer {
  const won = leads.filter((l) => l.activated);
  const space = buildFeatureSpace(leads);
  const forests = new Map<ProductId, Forest | number>();

  catalogue.products.forEach((product, index) => {
    const eligible = won.filter((l) => !eligibilityBlock(product, l.profile, l.segment));
    const labels = eligible.map((l) => (l.bundle.has(product.id) ? 1 : 0));
    const positives = labels.reduce<number>((sum, label) => sum + label, 0);
    if (positives === 0 || positives === labels.length) {
      forests.set(product.id, positives === 0 ? 0 : 1);
      return;
    }
    const rows = eligible.map((l) => space.encode(l.profile, l.segment));
    forests.set(product.id, trainForest(rows, labels, { trees: options.trees ?? 150, minLeaf: options.minLeaf ?? MIN_LEAF, seed: (options.seed ?? 1) + index }));
  });

  return (id, profile, segment) => {
    const model = forests.get(id) ?? 0;
    return typeof model === "number" ? model : predictForest(model, space.encode(profile, segment));
  };
}
