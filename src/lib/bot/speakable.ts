import { getQuestions } from '../questions';
import { ACKNOWLEDGEMENTS, CLOSING_MESSAGE, FIXED_LINES } from './script';

/**
 * Every line Accel Bot can say in the ElevenLabs voice: its fixed lines plus each question the backend can ask
 * (profile and add-on questions; contact details are a form, never spoken). The questions are built from the
 * product catalogue and training CSVs only, so this needs no database or LLM and runs in scripts too.
 *
 * The TTS route speaks only these lines, and `npm run bot:voice` pre-generates them. Anything else the bot says,
 * such as the LLM's "I couldn't tell…" replies, uses the browser voice instead.
 */
export function speakableLines(): readonly string[] {
  const questions = getQuestions()
    .questions.filter((q) => q.phase === 'profile' || q.phase === 'add_ons')
    .map((q) => q.question);
  return [...new Set([...questions, ...ACKNOWLEDGEMENTS, CLOSING_MESSAGE, ...FIXED_LINES])];
}

let cached: ReadonlySet<string> | null = null;
export function isSpeakable(text: string): boolean {
  cached ??= new Set(speakableLines());
  return cached.has(text);
}
