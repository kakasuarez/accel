// The languages Accel Bot offers. Client-safe: imported by the bot UI and the server alike.
//
// Only `available` languages can be chosen, stored on a lead, translated or spoken. The others are listed in the
// picker so customers can see they're coming. To turn one on: set `available`, add its code to LANGS and to the
// check in the leads table, run `npm run translate`, add a font for its script in src/app/layout.tsx, and set a
// `ttsModel` if the default ElevenLabs model doesn't speak it (Multilingual v2 covers Hindi and Tamil, not
// Bengali, Marathi, Telugu or Kannada).

/** Languages the bot can run in. Must match the check on leads.language (supabase/migrations). */
export const LANGS = ['en', 'hi', 'ta'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'en';

export interface LanguageInfo {
  code: string;
  englishName: string;
  /** The language's name in its own script, as the picker shows it. */
  nativeName: string;
  /** For speech recognition, browser voices and the `lang` attribute. */
  bcp47: string;
  /** ISO 639-3 code ElevenLabs Scribe takes as `language_code`. */
  sttCode: string;
  available: boolean;
  /** ElevenLabs text-to-speech model for this language. Unset uses ELEVENLABS_TTS_MODEL or the default. */
  ttsModel?: string;
}

export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'en', englishName: 'English', nativeName: 'English', bcp47: 'en-IN', sttCode: 'eng', available: true },
  { code: 'hi', englishName: 'Hindi', nativeName: 'हिन्दी', bcp47: 'hi-IN', sttCode: 'hin', available: true },
  { code: 'ta', englishName: 'Tamil', nativeName: 'தமிழ்', bcp47: 'ta-IN', sttCode: 'tam', available: true },
  { code: 'bn', englishName: 'Bengali', nativeName: 'বাংলা', bcp47: 'bn-IN', sttCode: 'ben', available: false },
  { code: 'mr', englishName: 'Marathi', nativeName: 'मराठी', bcp47: 'mr-IN', sttCode: 'mar', available: false },
  { code: 'te', englishName: 'Telugu', nativeName: 'తెలుగు', bcp47: 'te-IN', sttCode: 'tel', available: false },
  { code: 'kn', englishName: 'Kannada', nativeName: 'ಕನ್ನಡ', bcp47: 'kn-IN', sttCode: 'kan', available: false },
];

export const isLang = (value: unknown): value is Lang => typeof value === 'string' && (LANGS as readonly string[]).includes(value);

export function languageInfo(lang: Lang): LanguageInfo {
  return LANGUAGES.find((l) => l.code === lang)!;
}

/** The languages other than English that have translations. */
export const TRANSLATED_LANGS = LANGS.filter((l): l is Exclude<Lang, 'en'> => l !== 'en');
