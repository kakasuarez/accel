import { languageInfo, LANGS, type Lang } from '../i18n/languages';
import { localizeQuestion } from '../i18n/localize';
import { scriptFor } from '../i18n/ui';
import { getQuestions } from '../questions';

export interface SpeakableLine {
  text: string;
  /** The language the line is in. A line with no translation yet is English, and is spoken as English. */
  lang: Lang;
}

/**
 * Every line Accel Bot can say in the ElevenLabs voice, in every language it runs in: its fixed lines plus each
 * question the backend can ask (profile and add-on questions; contact details are a form, never spoken). The
 * questions are built from the product catalogue and training CSVs only, so this needs no database or LLM and
 * runs in scripts too.
 *
 * The TTS route speaks only these lines, and `npm run bot:voice` pre-generates them. Anything else the bot says,
 * such as the LLM's "I couldn't tell…" replies, uses the browser voice instead.
 */
export function speakableEntries(): readonly SpeakableLine[] {
  const questions = getQuestions().questions.filter((q) => q.phase === 'profile' || q.phase === 'add_ons');
  const seen = new Map<string, SpeakableLine>();
  // English first, so a line that isn't translated yet counts as English.
  for (const lang of LANGS) {
    const script = scriptFor(lang);
    const lines = [...questions.map((q) => localizeQuestion(q, lang).question), ...script.acknowledgements, script.closing, script.greeting, script.welcomeBack];
    for (const text of lines) if (!seen.has(text)) seen.set(text, { text, lang });
  }
  return [...seen.values()];
}

export const speakableLines = (): readonly string[] => speakableEntries().map((line) => line.text);

let cached: ReadonlyMap<string, Lang> | null = null;
const languages = () => (cached ??= new Map(speakableEntries().map((line) => [line.text, line.lang])));

export function isSpeakable(text: string): boolean {
  return languages().has(text);
}

/** The language of one of the bot's lines, or undefined if it isn't one. */
export const lineLanguage = (text: string): Lang | undefined => languages().get(text);

/** The ElevenLabs model for a language: its own if it needs one, otherwise `defaultModel`. */
export const ttsModelFor = (lang: Lang, defaultModel: string) => languageInfo(lang).ttsModel ?? defaultModel;
