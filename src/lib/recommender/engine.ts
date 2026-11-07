import { eligibilityBlock } from "./eligibility";
import { FIRST_BUSINESS_LINK, PEOPLE_UNITS, buildInsights, rate, type Insights } from "./insights";
import { forestScorer, frequencyScorer, type ModelOptions, type Scorer } from "./model/scorer";
import { buildSegmentIndex } from "./segments";
import { DEFAULT_SENSITIVITY, type Sensitivity } from "./sensitivity";
import type {
  AddOnOption,
  AddOnRecommendation,
  AlternativeLink,
  BlockedProduct,
  BundleLine,
  BundleTotals,
  BusinessProfile,
  Catalogue,
  Choices,
  Flag,
  Lead,
  LineRole,
  OpenQuestion,
  Product,
  ProductId,
  Recommendation,
  Segment,
} from "./types";

/** Leads drop out with "Installation delayed beyond 21 days". */
const LONG_INSTALL_DAYS = 21;
const MAX_OPEN_QUESTIONS = 4;

/** A choice the catalogue rules don't allow, such as a link this customer can't have. */
export class ChoiceError extends RangeError {
  override name = "ChoiceError";
}

/**
 * Checks by name, not instanceof: Next.js builds the recommender (created once at startup) and the routes
 * into separate bundles, so a ChoiceError thrown by it isn't an instance of the routes' copy of the class.
 */
export const isChoiceError = (error: unknown): error is ChoiceError => error instanceof Error && error.name === "ChoiceError";

export interface Recommender {
  /** With `choices`, the same rules rebuild the bundle around the customer's changes. */
  recommend(profile: BusinessProfile, choices?: Choices): Recommendation;
  cityTierOf(city: string): number | undefined;
  /** From data/price_sensitivity.csv; medium for a segment it doesn't list. */
  priceSensitivity(segment: Segment): Sensitivity;
  businessTypes: readonly string[];
  /** Cities seen in the leads, the only ones whose tier is known. */
  cities: readonly string[];
  /** Values of `currentInternet` seen in the leads. */
  currentInternetTypes: readonly string[];
  catalogue: Catalogue;
}

/** Totals for the base bundle plus the add-ons the customer picked, at their suggested quantities. */
export function priceWithAddOns(recommendation: Recommendation, picked: readonly ProductId[]): BundleTotals {
  const chosen = picked.map((id) => {
    const option = recommendation.addOns.find((a) => a.productId === id);
    if (!option) throw new RangeError(`${id} isn't an available add-on for this recommendation`);
    return option;
  });
  return totalsOf([...recommendation.lines, ...chosen]);
}

function totalsOf(items: readonly BundleLine[] | readonly (BundleLine | AddOnOption)[]): BundleTotals {
  const sum = (pick: (item: BundleLine | AddOnOption) => number) => items.reduce((total, item) => total + pick(item), 0);
  return {
    monthlyMin: sum((i) => i.monthlyMin),
    monthlyMax: sum((i) => i.monthlyMax),
    setupFee: sum((i) => i.setupFee),
    contractMonths: Math.max(0, ...items.map((i) => i.minContractMonths)),
    installDays: Math.max(0, ...items.map((i) => i.installDays)),
  };
}

/**
 * Builds everything from the two datasets: nothing about any product is known ahead of time.
 * The model scores products; catalogue rules decide what it may choose from.
 */
export function createRecommender(
  catalogue: Catalogue,
  leads: readonly Lead[],
  model: ModelOptions = {},
  sensitivity: ReadonlyMap<Segment, Sensitivity> = new Map(),
): Recommender {
  const insights = buildInsights(catalogue, leads);
  const segments = buildSegmentIndex(leads);
  const score: Scorer = model.kind === "frequency" ? frequencyScorer(insights) : forestScorer(catalogue, leads, model);

  function recommend(profile: BusinessProfile, choices: Choices = {}): Recommendation {
    const recommended = build(profile, {});
    if (!choices.link && !choices.mobile && !choices.quantities) return recommended;
    return build(profile, choices, recommended);
  }

  /** `recommended` is the untouched bundle, given when `choices` change it. */
  function build(profile: BusinessProfile, choices: Choices, recommended?: Recommendation): Recommendation {
    assertValid(profile);
    const { segment, inferred } = segments.classify(profile.businessType, profile.employees, profile.sites);
    const scoreOf = (product: Product) => score(product.id, profile, segment);
    const byScore = (a: Product, b: Product) => scoreOf(b) - scoreOf(a) || a.priceMin - b.priceMin;
    const allowed = (product: Product, selected?: ReadonlySet<ProductId>) => !eligibilityBlock(product, profile, segment, selected);

    const blocked: BlockedProduct[] = [];
    const noteBlock = (product: Product) => {
      const block = eligibilityBlock(product, profile, segment, selected);
      if (block) blocked.push({ productId: product.id, name: product.name, ...block });
    };
    const lines: BundleLine[] = [];
    const selected = new Set<ProductId>();
    const addLine = (product: Product, role: LineRole) => {
      const wanted = choices.quantities?.[product.id];
      if (wanted !== undefined) {
        const adjustable = role !== "link" && PEOPLE_UNITS.includes(product.unit);
        const max = Math.max(profile.employees, insights.quantity(segment, product, profile));
        if (!adjustable) throw new ChoiceError(`${product.name} quantity can't be changed`);
        if (!Number.isInteger(wanted) || wanted < 1 || wanted > max) throw new ChoiceError(`${product.name} quantity must be a whole number from 1 to ${max}`);
      }
      // A swap keeps the quantity it replaces, so the price difference holds.
      const before = recommended?.lines.find((l) => l.role === role);
      const carried = before && before.productId !== product.id && role !== "core" ? before.quantity : undefined;
      lines.push({ ...priced(product, product.description, wanted ?? carried), role });
      selected.add(product.id);
    };
    const priced = (product: Product, why: string, quantityChoice?: number) => {
      const quantity = quantityChoice ?? insights.quantity(segment, product, profile);
      return {
        productId: product.id,
        name: product.name,
        category: product.category,
        quantity,
        unit: product.unit,
        why,
        support: insights.support(segment, product.id),
        score: scoreOf(product),
        monthlyMin: quantity * product.priceMin,
        monthlyMax: quantity * product.priceMax,
        setupFee: quantity * product.setupFee,
        minContractMonths: product.minContractMonths,
        installDays: product.installDays,
      };
    };

    // 1. Link first, because other products depend on it.
    const links = catalogue.products.filter((p) => p.role === "link");
    const allowedLinks = links.filter((p) => allowed(p)).sort(byScore);
    let link: Product | undefined = allowedLinks[0];
    if (choices.link) {
      link = allowedLinks.find((p) => p.id === choices.link);
      if (!link) throw new ChoiceError(`${choices.link} isn't an internet connection this business can have`);
    } else if (link && profile.heavyBandwidth) {
      const upgrades = links.filter((p) => isFasterAndDearer(p, link!) && p.targetSegments.includes(segment));
      const upgrade = upgrades.filter((p) => allowed(p)).sort((a, b) => a.priceMin - b.priceMin)[0];
      if (upgrade) link = upgrade;
      else upgrades.forEach(noteBlock);
    }
    if (link) addLine(link, "link");
    else links.filter((p) => p.targetSegments.includes(segment)).forEach(noteBlock);

    // 2. Mobile: in every real bundle.
    const allowedMobiles = catalogue.products.filter((p) => p.role === "mobile" && allowed(p)).sort(byScore);
    let mobile: Product | undefined = allowedMobiles[0];
    if (choices.mobile) {
      mobile = allowedMobiles.find((p) => p.id === choices.mobile);
      if (!mobile) throw new ChoiceError(`${choices.mobile} isn't a mobile plan this business can have`);
    }
    if (mobile) addLine(mobile, "mobile");

    // 3. Add-ons nearly everyone in the segment buys, unless the customer declined.
    const needs = profile.needs ?? {};
    const addOns = catalogue.products.filter((p) => p.role === "add_on");
    for (const product of addOns) {
      if (insights.isCore(segment, product.id) && needs[product.id] !== false && allowed(product, selected)) addLine(product, "core");
    }

    // 4. Everything else goes in the picker. The customer decides.
    const available: Product[] = [];
    for (const product of addOns) {
      if (selected.has(product.id)) continue;
      if (allowed(product, selected)) available.push(product);
      else if (needs[product.id] === true) noteBlock(product);
    }
    const stated = available.filter((p) => needs[p.id] === true);
    const modelPicks = available
      .filter((p) => needs[p.id] === undefined && insights.support(segment, p.id))
      .sort(byScore)
      .slice(0, Math.max(0, insights.recommendedCount(segment) - stated.length));
    const others = available.filter((p) => !stated.includes(p) && !modelPicks.includes(p));
    const unanswered = others.filter((p) => needs[p.id] === undefined).sort(byScore);
    // Declined products stay available in case the customer changes their mind.
    const declined = others.filter((p) => needs[p.id] === false).sort(byScore);

    const toOption = (product: Product, recommendation: AddOnRecommendation | null): AddOnOption => {
      const support = insights.support(segment, product.id);
      const why = recommendation === "model" && support ? `${product.description}. ${percent(rate(support))} of similar customers added this.` : product.description;
      return { ...priced(product, why), recommendation };
    };

    const totals = totalsOf(lines);
    return {
      segment,
      segmentLabel: insights.segmentLabel(segment),
      lines,
      totals,
      alternatives: link ? alternativesFor(allowedLinks, link, lines, segment, insights) : [],
      mobileAlternatives: mobile ? alternativesFor(allowedMobiles, mobile, lines, segment, insights) : [],
      addOns: [
        ...stated.map((p) => toOption(p, "stated_need")),
        ...modelPicks.map((p) => toOption(p, "model")),
        ...unanswered.map((p) => toOption(p, null)),
        ...declined.map((p) => toOption(p, null)),
      ],
      blocked,
      flags: [...flagsFor(profile, segment, inferred, link, lines, totals.installDays, catalogue, insights), ...choiceFlags(profile, link, recommended, catalogue)],
      openQuestions: openQuestions(profile, [...modelPicks, ...unanswered], lines, catalogue),
    };
  }

  const distinct = (values: (string | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
  return {
    recommend,
    cityTierOf: insights.cityTierOf,
    priceSensitivity: (segment) => sensitivity.get(segment) ?? DEFAULT_SENSITIVITY,
    businessTypes: segments.businessTypes,
    cities: distinct(leads.map((l) => l.city)),
    currentInternetTypes: distinct(leads.map((l) => l.profile.currentInternet)),
    catalogue,
  };
}

function isFasterAndDearer(candidate: Product, current: Product): boolean {
  return (candidate.speedMbps ?? 0) > (current.speedMbps ?? 0) && candidate.priceMin > current.priceMin;
}

/** The other allowed products for a line, priced at the line's current quantity. */
function alternativesFor(allowedProducts: Product[], current: Product, lines: readonly BundleLine[], segment: Segment, insights: Insights): AlternativeLink[] {
  const line = lines.find((l) => l.productId === current.id)!;
  return allowedProducts
    .filter((p) => p.id !== current.id)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      monthlyMinDelta: line.quantity * (p.priceMin - current.priceMin),
      support: insights.support(segment, p.id),
    }));
}

/** Warns, without blocking, when a heavy internet user picks a slower connection than we recommended. */
function choiceFlags(profile: BusinessProfile, link: Product | undefined, recommended: Recommendation | undefined, catalogue: Catalogue): Flag[] {
  const recommendedLink = catalogue.byId.get(recommended?.lines.find((l) => l.role === "link")?.productId ?? "");
  if (!profile.heavyBandwidth || !link || !recommendedLink) return [];
  if ((link.speedMbps ?? 0) >= (recommendedLink.speedMbps ?? 0)) return [];
  return [
    {
      code: "slower_link_chosen",
      audience: "customer",
      message: `You told us you use the internet a lot, so ${link.name} may feel slow at busy times. We recommended ${recommendedLink.name}.`,
    },
  ];
}

function flagsFor(
  profile: BusinessProfile,
  segment: Segment,
  inferred: boolean,
  link: Product | undefined,
  lines: BundleLine[],
  installDays: number,
  catalogue: Catalogue,
  insights: Insights,
): Flag[] {
  const flags: Flag[] = [];
  if (inferred) {
    flags.push({
      code: "segment_inferred",
      audience: "customer",
      message: `We treated this business as "${insights.segmentLabel(segment)}" based on its size and type. Please confirm.`,
    });
  }
  if (!link) {
    flags.push({
      code: "no_eligible_link",
      audience: "customer",
      message: "None of our internet connections fit this business yet. Our team can look at the options with you.",
    });
  }
  if (link && profile.fibreAvailable === undefined && link.needsFibre) {
    const fallback = catalogue.products
      .filter((p) => p.role === "link" && !eligibilityBlock(p, { ...profile, fibreAvailable: false }, segment))
      .sort((a, b) => a.priceMin - b.priceMin)[0];
    flags.push({
      code: "fibre_unconfirmed",
      audience: "customer",
      message: `${link.name} depends on fibre at the site.${fallback ? ` If it isn't available, ${fallback.name} is the alternative.` : ""}`,
    });
  }
  const linkLine = lines.find((l) => l.role === "link");
  if (link && linkLine && linkLine.quantity < profile.sites) {
    flags.push({
      code: "second_site_not_covered",
      audience: "customer",
      message: `This quote covers ${linkLine.quantity} of your ${profile.sites} locations. If the others need their own connection, add another ${link.name}.`,
    });
  }
  if ((segment === "micro" || segment === "prof") && FIRST_BUSINESS_LINK.includes(profile.currentInternet ?? "")) {
    const { firstBusinessLink: first, existingBusinessLink: existing } = insights.retention;
    flags.push({
      code: "retention_risk_first_business_link",
      audience: "internal",
      message: `First-time business connection. These customers churned at ${percent(rate(first))} within 6 months, vs ${percent(rate(existing))} for those already on one. Plan extra onboarding.`,
    });
  }
  if (!profile.hasGstin) {
    const { without, with: withGstin, withoutButHasUdyam } = insights.gstin;
    flags.push({
      code: "kyc_risk_no_gstin",
      audience: "internal",
      message: `No GSTIN. Of leads reaching needs assessment, ${percent(rate(without))} activated (${percent(rate(withoutButHasUdyam))} with Udyam), vs ${percent(rate(withGstin))} with a GSTIN, mostly lost at the paperwork stage. Sort out documents before quoting.`,
    });
  }
  if (profile.cityTier === 2 && link?.needsFibre) {
    const { tier1, tier2 } = insights.fibreDelivery;
    flags.push({
      code: "tier2_fibre_delivery_risk",
      audience: "internal",
      message: `Tier 2 fibre. ${percent(rate(tier2))} of KYC-complete leads activated, vs ${percent(rate(tier1))} in tier 1, through feasibility failures, install delays and cancellations. Confirm feasibility and an install date before paperwork.`,
    });
  }
  if (installDays >= LONG_INSTALL_DAYS) {
    flags.push({ code: "long_install", audience: "customer", message: `Full setup may take up to ${installDays} days. Other items can go live sooner.` });
  }
  return flags;
}

function openQuestions(profile: BusinessProfile, addOnsToConfirm: Product[], lines: BundleLine[], catalogue: Catalogue): OpenQuestion[] {
  const questions: OpenQuestion[] = [];
  if (profile.fibreAvailable === undefined) {
    questions.push({ key: "fibreAvailable", question: "Is fibre available at your location?" });
  }
  if (profile.heavyBandwidth === undefined) {
    questions.push({ key: "heavyBandwidth", question: "Does your business use the internet a lot, for things like video calls, sending big files or working online all day?" });
  }
  // Confirm what the model is guessing first, then core items someone may already have.
  const core = lines.filter((l) => l.role === "core" && profile.needs?.[l.productId] === undefined).map((l) => catalogue.byId.get(l.productId)!);
  for (const product of [...addOnsToConfirm, ...core]) {
    questions.push({ key: product.id, question: productQuestion(product) });
  }
  return questions.slice(0, MAX_OPEN_QUESTIONS);
}

/** The catalogue's plain-language question, or one made from the product's name and description. */
export function productQuestion(product: Product): string {
  return product.customerQuestion ?? `Would you like ${product.name}? ${product.description}.`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function assertValid(profile: BusinessProfile): void {
  if (!Number.isInteger(profile.employees) || profile.employees < 1) {
    throw new RangeError(`employees must be a positive integer, got ${profile.employees}`);
  }
  if (!Number.isInteger(profile.sites) || profile.sites < 1) {
    throw new RangeError(`sites must be a positive integer, got ${profile.sites}`);
  }
  if (!Number.isInteger(profile.cityTier) || profile.cityTier < 1) {
    throw new RangeError(`cityTier must be a positive integer, got ${String(profile.cityTier)}`);
  }
}
