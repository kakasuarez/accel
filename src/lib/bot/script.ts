// Accel Bot's own fixed lines. The questions and the recommended bundle come from the backend
// (GET/POST /api/leads…); see src/lib/bot/speakable.ts for the full list of lines the bot can speak.
// Client-safe: imported by the bot UI, so nothing here may pull in server code.

/** Said before the next question after an answer is understood. Professional, short, never repeated back to back. */
export const ACKNOWLEDGEMENTS = [
  'Got it.',
  'Thank you.',
  'Understood.',
  'Noted, thank you.',
  'That helps.',
  'Thanks, that’s useful.',
  'Perfect.',
  'Clear, thank you.',
];

export function pickAcknowledgement(previous?: string): string {
  const pool = ACKNOWLEDGEMENTS.filter((a) => a !== previous);
  return pool[Math.floor(Math.random() * pool.length)];
}

export const GREETING = 'Hi, I’m Accel Bot. I’ll ask a few quick questions about your business, then suggest a bundle that fits.';

export const CLOSING_MESSAGE =
  'Thank you, that’s everything I need. Based on what you’ve told me, here’s the bundle I’d start your business with.';

/** Said instead of the greeting when the owner comes back to a conversation they started earlier. */
export const WELCOME_BACK = 'Welcome back. Let’s pick up where we left off.';

/** Other fixed lines the bot speaks. Add any new fixed spoken line here so it gets a pre-generated clip. */
export const FIXED_LINES: readonly string[] = [GREETING, WELCOME_BACK];

/** Pre-generated voice files: public/bot-voice/manifest.json, written by scripts/bot-voice.ts. */
export const VOICE_MANIFEST_PATH = '/bot-voice/manifest.json';

export interface VoiceManifest {
  voice: string;
  model: string;
  generatedAt: string;
  /** Line text → file name inside /bot-voice/. */
  lines: Record<string, string>;
}

export function formatRupees(amount: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}
