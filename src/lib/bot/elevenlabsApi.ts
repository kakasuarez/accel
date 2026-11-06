// Raw ElevenLabs text-to-speech request, shared by the API route (src/lib/bot/elevenlabs.ts)
// and the pre-generation script (scripts/bot-voice.ts). No Next.js imports, so it runs under tsx.
import { createHash } from 'node:crypto';

export const ELEVENLABS_API = 'https://api.elevenlabs.io/v1';
/** "Sarah", a premade voice available on every plan. Pick an Indian-English voice and set ELEVENLABS_VOICE_ID. */
export const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
export const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';
export const DEFAULT_STT_MODEL = 'scribe_v2';

export class ElevenLabsError extends Error {}

export interface VoiceSettings {
  key: string;
  voice: string;
  model: string;
}

/** Reads the ElevenLabs settings from the environment. `key` is null when no key is configured. */
export function voiceSettingsFromEnv(): Omit<VoiceSettings, 'key'> & { key: string | null } {
  return {
    key: process.env.ELEVENLABS_API_KEY?.trim() || null,
    voice: process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID,
    model: process.env.ELEVENLABS_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL,
  };
}

/** Stable file name for one line in one voice/model, so changed lines get new files and unchanged ones are reused. */
export function clipName({ voice, model }: Pick<VoiceSettings, 'voice' | 'model'>, text: string): string {
  return createHash('sha256').update(`${voice}\n${model}\n${text}`).digest('hex').slice(0, 32) + '.mp3';
}

export async function requestSpeech({ key, voice, model }: VoiceSettings, text: string): Promise<Buffer> {
  const res = await fetch(`${ELEVENLABS_API}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.2, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new ElevenLabsError(`Text-to-speech failed (${res.status}): ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}
