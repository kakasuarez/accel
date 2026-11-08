import 'server-only';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_STT_MODEL,
  ELEVENLABS_API,
  ElevenLabsError,
  clipName,
  requestSpeech,
  voiceSettingsFromEnv,
} from './elevenlabsApi';
import { lineLanguage, ttsModelFor } from './speakable';

// ElevenLabs text-to-speech and speech-to-text for Accel Bot.
// Configure in .env.local (see .env.local.example). Without a key the bot falls back to the browser.
// For deployment, pre-generate the bot's lines with `npm run bot:voice` (served from public/bot-voice/).

export { ElevenLabsError };

const CACHE_DIR = path.join(process.cwd(), '.cache', 'tts');

export function isConfigured(): boolean {
  return voiceSettingsFromEnv().key !== null;
}

// The bot's lines never change, so each one is generated once and served from disk afterwards.
const inFlight = new Map<string, Promise<Buffer>>();

export function synthesize(text: string): Promise<Buffer> {
  const settings = voiceSettingsFromEnv();
  const { key, voice } = settings;
  if (!key) throw new ElevenLabsError('ELEVENLABS_API_KEY is not set.');
  const model = ttsModelFor(lineLanguage(text) ?? 'en', settings.model);
  const name = clipName({ voice, model }, text);

  const pending = inFlight.get(name);
  if (pending) return pending;

  const file = path.join(CACHE_DIR, name);
  const job = readFile(file)
    .catch(async () => {
      const audio = await requestSpeech({ key, voice, model }, text);
      // A read-only filesystem (e.g. serverless hosting) just means no disk cache.
      await mkdir(CACHE_DIR, { recursive: true })
        .then(() => writeFile(file, audio))
        .catch(() => {});
      return audio;
    })
    .finally(() => inFlight.delete(name));
  inFlight.set(name, job);
  return job;
}

/**
 * `languageCode` (ISO 639-3, e.g. "hin") tells Scribe which language to expect. Without it Scribe guesses, and
 * can confuse Hindi with Marathi or write Hindi speech in Urdu script.
 */
export async function transcribe(audio: Blob, languageCode?: string): Promise<string> {
  const { key } = voiceSettingsFromEnv();
  if (!key) throw new ElevenLabsError('ELEVENLABS_API_KEY is not set.');
  const form = new FormData();
  form.append('model_id', process.env.ELEVENLABS_STT_MODEL?.trim() || DEFAULT_STT_MODEL);
  form.append('file', audio, 'answer');
  form.append('tag_audio_events', 'false');
  if (languageCode) form.append('language_code', languageCode);

  const res = await fetch(`${ELEVENLABS_API}/speech-to-text`, { method: 'POST', headers: { 'xi-api-key': key }, body: form });
  if (!res.ok) throw new ElevenLabsError(`Speech-to-text failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').replace(/\s+/g, ' ').trim();
}
