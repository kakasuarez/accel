/**
 * Pre-generates Accel Bot's spoken lines with ElevenLabs into public/bot-voice/, so a deployed app
 * plays them as static files and never calls ElevenLabs for speech.
 *
 *   npm run bot:voice            generate new or changed lines, reuse the rest, remove stale files
 *   npm run bot:voice -- --force regenerate every line
 *   npm run bot:voice -- --dry   list what would be generated, without calling ElevenLabs
 *
 * Reads ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID / ELEVENLABS_TTS_MODEL from .env.local.
 * Re-run after changing the fixed lines in src/lib/bot/script.ts, the product catalogue or training CSVs
 * (the backend's questions are built from them), or the voice.
 */
import fs from 'node:fs';
import path from 'node:path';
import nextEnv from '@next/env';
import { ElevenLabsError, clipName, requestSpeech, voiceSettingsFromEnv } from '../src/lib/bot/elevenlabsApi';
import type { VoiceManifest } from '../src/lib/bot/script';
import { speakableLines } from '../src/lib/bot/speakable';

const SPEAKABLE_LINES = speakableLines();

const OUT_DIR = path.join(process.cwd(), 'public', 'bot-voice');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');
const CACHE_DIR = path.join(process.cwd(), '.cache', 'tts');

async function main() {
  nextEnv.loadEnvConfig(process.cwd());
  const force = process.argv.includes('--force');
  const dry = process.argv.includes('--dry');

  const { key, voice, model } = voiceSettingsFromEnv();
  if (!key && !dry) {
    console.error('ELEVENLABS_API_KEY is not set. Add it to .env.local (see .env.local.example).');
    process.exit(1);
  }

  const plan = SPEAKABLE_LINES.map((text) => ({ text, file: clipName({ voice, model }, text) }));
  const todo = plan.filter((p) => force || !fs.existsSync(path.join(OUT_DIR, p.file)));
  const chars = todo.reduce((n, p) => n + p.text.length, 0);

  console.log(`Voice ${voice}, model ${model}`);
  console.log(`${plan.length} lines: ${todo.length} to generate (${chars} characters), ${plan.length - todo.length} already up to date.`);
  if (dry) {
    todo.forEach((p) => console.log(`  would generate  ${p.text}`));
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // One at a time: the free plan allows only a couple of concurrent requests.
  let copied = 0;
  for (const [i, p] of todo.entries()) {
    process.stdout.write(`  [${i + 1}/${todo.length}] ${p.text} … `);
    // The dev server's cache uses the same file names: reuse a clip it already paid for.
    const cached = path.join(CACHE_DIR, p.file);
    if (!force && fs.existsSync(cached)) {
      fs.copyFileSync(cached, path.join(OUT_DIR, p.file));
      copied++;
      console.log('copied from .cache/tts');
      continue;
    }
    const audio = await requestSpeech({ key: key!, voice, model }, p.text);
    fs.writeFileSync(path.join(OUT_DIR, p.file), audio);
    console.log(`${Math.round(audio.length / 1024)} KB`);
  }

  // Remove clips for lines that no longer exist or were made with another voice/model.
  const keep = new Set(plan.map((p) => p.file));
  const stale = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.mp3') && !keep.has(f));
  stale.forEach((f) => fs.unlinkSync(path.join(OUT_DIR, f)));

  const manifest: VoiceManifest = {
    voice,
    model,
    generatedAt: new Date().toISOString(),
    lines: Object.fromEntries(plan.map((p) => [p.text, p.file])),
  };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    `Done. ${todo.length - copied} generated, ${copied} copied from cache, ${stale.length} stale removed. ` +
      'Manifest: public/bot-voice/manifest.json',
  );
}

main().catch((err) => {
  console.error(err instanceof ElevenLabsError ? err.message : err);
  process.exit(1);
});
