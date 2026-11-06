'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VOICE_MANIFEST_PATH, type VoiceManifest } from '@/lib/bot/script';

/** Pre-generated clips (npm run bot:voice). Loaded once per page; an empty map when none were generated. */
let manifestPromise: Promise<Record<string, string>> | null = null;
function loadManifest() {
  manifestPromise ??= fetch(VOICE_MANIFEST_PATH)
    .then((r) => (r.ok ? (r.json() as Promise<VoiceManifest>) : null))
    .then((m) => m?.lines ?? {})
    .catch(() => ({}));
  return manifestPromise;
}

const MUTE_KEY = 'accel-bot-muted';
const LINE_GAP_MS = 180;

/** Upper bound for one line, so a speech engine that never reports "ended" can't block the mic forever. */
const maxLineMs = (text: string) => 3000 + text.split(/\s+/).length * 600;

/** Best browser voice for Indian English, used when the server voice isn't available. */
function pickBrowserVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const natural = (v: SpeechSynthesisVoice) => /natural|online|neural|premium|enhanced/i.test(v.name);
  const india = (v: SpeechSynthesisVoice) => /-in$/i.test(v.lang);
  return (
    en.find((v) => india(v) && natural(v)) ??
    en.find(natural) ??
    en.find(india) ??
    en.find((v) => /google/i.test(v.name)) ??
    en[0] ??
    null
  );
}

/**
 * Speaks the bot's lines. Uses server audio (ElevenLabs) when `serverVoice` is true, otherwise the browser's
 * speech synthesis. `speak` resolves when the lines have finished, been stopped, or been muted.
 */
export function useBotSpeech(serverVoice: boolean) {
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const mutedRef = useRef(false);
  const runRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const finishLine = useRef<(() => void) | null>(null);
  const clips = useRef(new Map<string, Promise<string | null>>());

  useEffect(() => {
    const saved = window.localStorage.getItem(MUTE_KEY) === '1';
    mutedRef.current = saved;
    setMuted(saved);
    // Some browsers load their voice list asynchronously.
    window.speechSynthesis?.getVoices();
    const urls = clips.current;
    return () => {
      runRef.current++;
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
      urls.forEach((p) => p.then((u) => u?.startsWith('blob:') && URL.revokeObjectURL(u)));
    };
  }, []);

  /**
   * Resolve (once) the audio for a line: a pre-generated static file, else live server audio,
   * else null to use the browser voice.
   */
  const clip = useCallback(
    (text: string) => {
      let p = clips.current.get(text);
      if (!p) {
        p = loadManifest().then(async (lines) => {
          const file = lines[text];
          if (file) {
            const url = `/bot-voice/${file}`;
            // Warm the HTTP cache so playback starts instantly; a missing file falls through.
            const ok = await fetch(url).then((r) => r.ok, () => false);
            if (ok) return url;
          }
          if (!serverVoice) return null;
          return fetch('/api/bot/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          })
            .then((r) => (r.ok ? r.blob() : null))
            .then((b) => (b ? URL.createObjectURL(b) : null))
            .catch(() => null);
        });
        clips.current.set(text, p);
      }
      return p;
    },
    [serverVoice],
  );

  const prefetch = useCallback((texts: string[]) => texts.forEach((t) => void clip(t)), [clip]);

  const playUrl = (url: string, text: string) =>
    new Promise<void>((resolve) => {
      const audio = audioRef.current ?? (audioRef.current = new Audio());
      const guard = window.setTimeout(() => finishLine.current?.(), maxLineMs(text));
      const done = () => {
        window.clearTimeout(guard);
        audio.onended = audio.onerror = null;
        finishLine.current = null;
        resolve();
      };
      finishLine.current = () => {
        audio.pause();
        done();
      };
      audio.onended = done;
      audio.onerror = done;
      audio.src = url;
      // Autoplay can be refused before the visitor has interacted with the page: skip the line silently.
      audio.play().catch(done);
    });

  const speakBrowser = (text: string) =>
    new Promise<void>((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      const voice = pickBrowserVoice();
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? 'en-IN';
      u.rate = 1;
      const guard = window.setTimeout(() => finishLine.current?.(), maxLineMs(text));
      const done = () => {
        window.clearTimeout(guard);
        finishLine.current = null;
        resolve();
      };
      finishLine.current = () => {
        synth.cancel();
        done();
      };
      u.onend = done;
      u.onerror = done;
      synth.speak(u);
    });

  const stop = useCallback(() => {
    runRef.current++;
    finishLine.current?.();
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    async (lines: string[]) => {
      stop();
      const run = runRef.current;
      if (mutedRef.current || lines.length === 0) return;
      setSpeaking(true);
      for (let i = 0; i < lines.length; i++) {
        const url = await clip(lines[i]);
        if (run !== runRef.current) return;
        if (url) await playUrl(url, lines[i]);
        else await speakBrowser(lines[i]);
        if (run !== runRef.current) return;
        if (i < lines.length - 1) await new Promise((r) => setTimeout(r, LINE_GAP_MS));
      }
      if (run === runRef.current) setSpeaking(false);
    },
    [clip, stop],
  );

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setMuted(next);
    window.localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    if (next) stop();
  }, [stop]);

  return { muted, speaking, speak, stop, prefetch, toggleMute };
}
