// Accel Bot's own copy: what the bot says (src/lib/bot/script.ts) and the text on its screens. Client-safe.
// English is the source. `npm run translate` writes data/locales/ui/<lang>.json from it; a missing or stale
// translation shows the English.
import hi from '../../../data/locales/ui/hi.json';
import ta from '../../../data/locales/ui/ta.json';
import { ACKNOWLEDGEMENTS, CLOSING_MESSAGE, GREETING, WELCOME_BACK } from '../bot/script';
import { format, lookup, type LocaleFile, type Vars } from './format';
import type { Lang } from './languages';

const FILES: Record<Exclude<Lang, 'en'>, LocaleFile> = { hi, ta };

export const UI = {
  // ---- Conversation ----
  'placeholder.answer': 'Type your answer',
  'placeholder.number': 'Type a number',
  'placeholder.numberUnit': 'Type a number ({unit})',
  'placeholder.pick': 'Type or pick an answer',
  'chips.label': 'Suggested answers',
  'chips.showAll': 'Show all {n}',
  'skip': 'Not sure',
  'checking': 'Checking your answer',
  'answer.label': 'Your answer',
  'answer.voice': 'Answer by voice',
  'answer.send': 'Send answer',
  'startOver': 'Start over',
  'loading': 'Loading your conversation',

  // ---- Header ----
  'header.home': 'Accel Business dashboard',
  'header.dashboard': 'Dashboard',
  'header.mute': 'Mute Accel Bot’s voice',
  'header.unmute': 'Unmute Accel Bot’s voice',
  'header.muteTitle': 'Mute voice',
  'header.unmuteTitle': 'Unmute voice',
  'header.progress': 'Questions answered',
  'count.profile': '{n} of {total}',
  'count.addOns': 'Add-ons {n} of {total}',
  'count.bundle': 'Your bundle',
  'count.accepted': 'Quote accepted',

  // ---- Language and privacy ----
  'language.title': 'Choose your language',
  'language.comingSoon': '{language} is coming soon. Please pick another language for now.',
  'language.change': 'Change language',
  'consent.title': 'Before we start',
  'consent.body':
    'Your answers are used to recommend a bundle and prepare your quote. If you answer by voice, your speech is turned into text by our speech provider or by your browser.',
  /** {link} is the Privacy Policy link. */
  'consent.agree': 'By continuing, you agree to our {link}.',
  'consent.privacy': 'Privacy Policy',
  'consent.newTab': '(opens in a new tab)',
  'consent.start': 'Let’s start',

  // ---- Voice ----
  'voice.group': 'Voice answer',
  'voice.exit': 'Exit voice mode',
  'voice.exitTitle': 'Exit voice mode and type',
  'voice.tapToSpeak': 'Tap to speak',
  'voice.sendNow': 'Send answer now',
  'voice.unsupported': 'This browser can’t turn speech into text yet',
  'voice.checking': 'Checking',
  'voice.paused': 'Paused',
  'voice.listening': 'Listening',
  'voice.transcribing': 'Transcribing',
  'voice.starting': 'Starting the microphone…',
  'voice.speaking': 'Speaking',
  'voice.next': 'Next question',
  'voice.nothingHeard': 'I didn’t hear anything, so I’ve paused the microphone.',
  'voice.stopped': 'The microphone stopped. Tap to speak again.',
  'voiceError.blocked': 'Microphone access is blocked. Allow it in your browser settings, or type your answer.',
  'voiceError.no-mic': 'No microphone was found on this device. Type your answer instead.',
  'voiceError.failed': 'Voice input stopped unexpectedly. Try again, or type your answer.',

  // ---- Other states ----
  'error.notFound': 'We couldn’t find that conversation.',
  'error.generic': 'Something went wrong. Please try again.',
  'error.network': 'We couldn’t reach Accel. Check your connection and try again.',
  'error.newConversation': 'Start a new conversation',
  'goDashboard': 'Go to your dashboard',
  'accepted.title': 'You’ve already accepted this bundle.',
  'accepted.body': 'Your quote is saved. Next, verify your business from your dashboard.',
  'accepted.newRequest': 'Start a new request',
  'noBundle': 'We couldn’t put a bundle together from these answers.',

  // ---- Result ----
  'explain.recommended': 'Writing a short note on why this fits your business',
  'explain.other': 'Writing a short note on this bundle',
  'tag.stated_need': 'You asked for this',
  'tag.model': 'Suggested for you',
  'tiers.title': 'Choose your bundle',
  'tiers.sub': 'Monthly prices before add-ons. You can switch any time before you accept.',
  'tiers.bestFit': 'Best fit',
  'tiers.ourPick': 'Our pick for your business, based on your answers.',
  'tiers.recommended': 'Recommended',
  'perMonth': 'a month',
  'bundle.named': '{label} bundle',
  'bundle.yours': 'Your bundle',
  'bundle.setup': 'One-time setup',
  'bundle.setupNone': 'None',
  'bundle.contract': 'Minimum contract',
  'bundle.installation': 'Installation',
  'bundle.installUpTo': 'Up to {days}',
  'bundle.included': 'Included in your bundle',
  'bundle.goodToKnow': 'Good to know',
  'months.one': '{n} month',
  'months.other': '{n} months',
  'days.one': '{n} day',
  'days.other': '{n} days',
  'addOns.title': 'Add to your bundle',
  'addOns.sub': 'Optional. Tick anything you’d like and the monthly price updates.',
  'addOns.more.one': 'Show {n} more add-on',
  'addOns.more.other': 'Show {n} more add-ons',
  'blocked.title': 'Why some services aren’t included',
  'accept.title': 'Accept this quote',
  /** {price} is the monthly price, shown in bold. */
  'accept.sub': 'At {price} a month. Next, you’ll verify your business with a few documents.',
  'accept.businessName': 'Business name',
  'accept.contactName': 'Your name',
  'accept.phone': 'Phone number',
  'accept.businessNameError': 'Enter your business’s name.',
  'accept.contactNameError': 'Enter the name of the person we should speak to.',
  'accept.phoneError': 'Enter a phone number, like +91 98765 43210.',
  'accept.failed': 'We couldn’t accept the quote. Please try again.',
  'accept.accepting': 'Accepting…',
  'accept.submit': 'Accept quote',
  'accept.note': 'Accel is a fictional operator. Prices are synthetic and shown per month.',
} as const;
export type UiKey = keyof typeof UI;

/** One of UI in the customer's language. */
export function uiText(lang: Lang, key: UiKey, vars?: Vars): string {
  return translate(lang, key, UI[key], vars);
}

/** `.one` or `.other` of a counted message, e.g. "1 month" or "3 months". */
export function uiCount(lang: Lang, key: 'months' | 'days' | 'addOns.more', n: number): string {
  return uiText(lang, `${key}.${n === 1 ? 'one' : 'other'}` as UiKey, { n });
}

function translate(lang: Lang, key: string, english: string, vars?: Vars): string {
  return format(lang === 'en' ? english : lookup(FILES[lang], key, english), vars);
}

// ---- What the bot says ----
// Spoken exactly as written, so the TTS whitelist and pre-generated clips must use these same strings.

export const SCRIPT_SOURCE: Readonly<Record<string, string>> = {
  'script.greeting': GREETING,
  'script.welcomeBack': WELCOME_BACK,
  'script.closing': CLOSING_MESSAGE,
  ...Object.fromEntries(ACKNOWLEDGEMENTS.map((line, i) => [`script.ack.${i}`, line])),
};

export interface Script {
  greeting: string;
  welcomeBack: string;
  closing: string;
  acknowledgements: string[];
}

export function scriptFor(lang: Lang): Script {
  const line = (key: string) => translate(lang, key, SCRIPT_SOURCE[key]!);
  return {
    greeting: line('script.greeting'),
    welcomeBack: line('script.welcomeBack'),
    closing: line('script.closing'),
    acknowledgements: ACKNOWLEDGEMENTS.map((_, i) => line(`script.ack.${i}`)),
  };
}

// ---- Catalogue units ----

/** Catalogue units read "per site", "per line": quantity 3 and "per site" read "3 sites" in English. */
export function englishQuantity(quantity: number, unit: string): string {
  const u = unit.trim().replace(/^per\s+/i, '');
  if (!u) return `× ${quantity}`;
  return `${quantity} ${u}${quantity === 1 || /s$/i.test(u) ? '' : 's'}`;
}

/** The templates `npm run translate` translates for one unit: "{n} site" and "{n} sites". */
export const quantityTemplates = (unit: string) => ({
  one: englishQuantity(1, unit).replace(/\b1\b/, '{n}'),
  other: englishQuantity(2, unit).replace(/\b2\b/, '{n}'),
});
export const quantityKey = (unit: string, form: 'one' | 'other') => `quantity.${unit}.${form}`;

export function quantityText(lang: Lang, quantity: number, unit: string): string {
  if (lang === 'en') return englishQuantity(quantity, unit);
  const form = quantity === 1 ? 'one' : 'other';
  return translate(lang, quantityKey(unit, form), quantityTemplates(unit)[form], { n: quantity });
}

/** A question's unit, such as "INR per month", for the number placeholder. */
export const unitKey = (unit: string) => `unit.${unit}`;
export const unitText = (lang: Lang, unit: string) => translate(lang, unitKey(unit), unit);
