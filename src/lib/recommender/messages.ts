import { format, type Vars } from "../i18n/format";

/**
 * The recommender's customer-facing sentences, as English templates. Each flag, block and comparison keeps the
 * key and values it was built from, so src/lib/i18n/localize.ts can rebuild it in the customer's language.
 * Internal flags are for staff only and stay plain English strings.
 */
export const MESSAGES = {
  "flag.segment_inferred": 'We treated this business as "{segment}" based on its size and type. Please confirm.',
  "flag.no_eligible_link": "None of our internet connections fit this business yet. Our team can look at the options with you.",
  "flag.fibre_unconfirmed": "{product} depends on fibre at the site.",
  "flag.fibre_unconfirmed.fallback": "{product} depends on fibre at the site. If it isn't available, {fallback} is the alternative.",
  "flag.second_site_not_covered": "This quote covers {covered} of your {sites} locations. If the others need their own connection, add another {product}.",
  "flag.long_install": "Full setup may take up to {days} days. Other items can go live sooner.",
  "flag.slower_link_chosen": "You told us you use the internet a lot, so {chosen} may feel slow at busy times. We recommended {recommended}.",
  "flag.city_unconfirmed": "Availability in {city} is to be confirmed, so this quote may change.",
  "flag.gstin_unconfirmed":
    "You weren't sure about GST registration, so we've left out products that need a GST number. You can confirm it when you upload your documents.",

  "block.segment": "{product} isn't offered to this type of business.",
  "block.city_tier": "{product} isn't available in tier {tier} cities yet.",
  "block.no_fibre": "{product} needs fibre, which isn't available at your location.",
  "block.min_employees": "{product} is for businesses with {min}+ employees.",
  "block.min_sites": "{product} is for businesses with {min}+ sites.",
  "block.gstin": "{product} requires a GSTIN.",
  "block.dependency": "{product} doesn't work with the internet connection in this bundle.",

  "addOn.share": "{description}. {percent} of similar customers added this.",

  "tier.recommended": "Recommended",
  "tier.budget": "Budget",
  "tier.premium": "Premium",

  "compare.saves": "Saves {amount} a month",
  "compare.more": "{amount} more a month",
  "compare.swap": "{now} instead of {before}",
  "compare.lines.one": "{now} mobile line instead of {before}",
  "compare.lines.other": "{now} mobile lines instead of {before}",
  "compare.withChanges": "{lead}: {changes}.",
  "compare.only": "{lead}.",
} as const;

export type MessageKey = keyof typeof MESSAGES;

export const message = (key: MessageKey, vars?: Vars) => format(MESSAGES[key], vars);
