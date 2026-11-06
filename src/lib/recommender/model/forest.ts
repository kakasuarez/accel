/**
 * A small seeded random forest for binary labels. Written here rather than pulled in
 * because it must return leaf probabilities and be repeatable run to run.
 */
type TreeNode = { leaf: number } | { feature: number; threshold: number; left: TreeNode; right: TreeNode };

export type Forest = TreeNode[];

export interface ForestOptions {
  trees: number;
  /** Each side of a split keeps at least this many samples. */
  minLeaf: number;
  seed: number;
}

/** Mulberry32. */
function createRandom(seed: number) {
  let state = seed;
  return (limit: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % limit;
  };
}

function gini(positives: number, total: number): number {
  const p = positives / total;
  return 2 * p * (1 - p);
}

function buildTree(
  rows: readonly (readonly number[])[],
  labels: readonly number[],
  sample: number[],
  options: ForestOptions,
  random: (limit: number) => number,
): TreeNode {
  const positives = sample.reduce((count, row) => count + labels[row]!, 0);
  const leaf = { leaf: positives / sample.length };
  if (positives === 0 || positives === sample.length || sample.length < 2 * options.minLeaf) return leaf;

  const featureCount = rows[0]!.length;
  const tries = Math.max(1, Math.round(Math.sqrt(featureCount)));
  const parentImpurity = gini(positives, sample.length);
  let best: { feature: number; threshold: number; gain: number } | undefined;

  // Keep looking past the first `tries` features if they were all constant, as scikit-learn does.
  const seen = new Set<number>();
  let usable = 0;
  while (usable < tries && seen.size < featureCount) {
    const feature = random(featureCount);
    if (seen.has(feature)) continue;
    seen.add(feature);
    const sorted = [...sample].sort((a, b) => rows[a]![feature]! - rows[b]![feature]!);
    if (rows[sorted[0]!]![feature] === rows[sorted.at(-1)!]![feature]) continue;
    usable++;

    let leftPositives = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      leftPositives += labels[sorted[i]!]!;
      const value = rows[sorted[i]!]![feature]!;
      const next = rows[sorted[i + 1]!]![feature]!;
      const leftSize = i + 1;
      const rightSize = sorted.length - leftSize;
      if (value === next || leftSize < options.minLeaf || rightSize < options.minLeaf) continue;
      const impurity =
        (leftSize * gini(leftPositives, leftSize) + rightSize * gini(positives - leftPositives, rightSize)) / sorted.length;
      const gain = parentImpurity - impurity;
      if (gain > (best?.gain ?? 0)) best = { feature, threshold: (value + next) / 2, gain };
    }
  }
  if (!best) return leaf;

  const { feature, threshold } = best;
  return {
    feature,
    threshold,
    left: buildTree(rows, labels, sample.filter((row) => rows[row]![feature]! <= threshold), options, random),
    right: buildTree(rows, labels, sample.filter((row) => rows[row]![feature]! > threshold), options, random),
  };
}

export function trainForest(rows: readonly (readonly number[])[], labels: readonly number[], options: ForestOptions): Forest {
  const random = createRandom(options.seed);
  return Array.from({ length: options.trees }, () => {
    const bootstrap = Array.from({ length: rows.length }, () => random(rows.length));
    return buildTree(rows, labels, bootstrap, options, random);
  });
}

export function predictForest(forest: Forest, row: readonly number[]): number {
  let total = 0;
  for (const root of forest) {
    let node = root;
    while (!("leaf" in node)) node = row[node.feature]! <= node.threshold ? node.left : node.right;
    total += node.leaf;
  }
  return total / forest.length;
}
