'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { languageInfo, type Lang } from '@/lib/i18n/languages';

// Minimal Web Speech API typings (not in lib.dom for every TS target).
interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  isFinal: boolean;
  0: SpeechAlternative;
}
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface SpeechErrorEvent {
  error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type VoiceStatus = 'off' | 'starting' | 'listening' | 'transcribing';
export type VoiceError = 'blocked' | 'no-mic' | 'failed';

/** Live audio levels, read every frame by the visualiser. All values 0–1. */
export interface VoiceLevels {
  level: number;
  bands: [number, number, number];
}

/** How long the speaker must stay quiet after talking before the answer is sent. */
export const SILENCE_MS = 1400;
/** Give up on a listening session that hears nothing at all for this long. */
const NO_SPEECH_MS = 8000;
/** Minimum mic level (0–1) counted as speech; raised automatically above the room's noise floor. */
const SPEECH_LEVEL = 0.18;
/** Hard stop for one answer, in case background noise never lets the pause register. */
const MAX_ANSWER_MS = 20000;
const STT_TIMEOUT_MS = 8000;

interface Options {
  /** Send recordings to /api/bot/stt for an accurate transcript (the browser text becomes a live preview). */
  serverStt: boolean;
  /** The language the customer speaks in. */
  lang: Lang;
  /** The speaker talked and then went quiet. */
  onHeard: (text: string) => void;
  /** The session ended without hearing anything. */
  onNothingHeard: () => void;
  onError: (error: VoiceError) => void;
}

export function useVoice({ serverStt, lang, onHeard, onNothingHeard, onError }: Options) {
  const langRef = useRef(lang);
  langRef.current = lang;
  const [status, setStatus] = useState<VoiceStatus>('off');
  const [finalText, setFinalText] = useState('');
  const [interimText, setInterimText] = useState('');
  const [hasRecognition, setHasRecognition] = useState(true);
  /** Timestamp of the silence countdown currently running, or null. Changes on every restart. */
  const [silenceSince, setSilenceSince] = useState<number | null>(null);

  const recRef = useRef<Recognition | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timeBuf = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const freqBuf = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const speakingRef = useRef(false);
  const heardVoiceRef = useRef(false);
  /** The level meter currently hears speech. */
  const vadTalkingRef = useRef(false);
  const maxTimer = useRef<number | null>(null);
  const pulseRef = useRef(0);
  const finalRef = useRef('');
  const interimRef = useRef('');
  const activeRef = useRef(false);
  const sessionRef = useRef(0);
  const restartedRef = useRef(false);
  const silenceTimer = useRef<number | null>(null);
  const noSpeechTimer = useRef<number | null>(null);
  const vadTimer = useRef<number | null>(null);
  const callbacks = useRef({ onHeard, onNothingHeard, onError });
  callbacks.current = { onHeard, onNothingHeard, onError };
  const serverSttRef = useRef(serverStt);
  serverSttRef.current = serverStt;

  useEffect(() => {
    setHasRecognition(getRecognitionCtor() !== null);
  }, []);

  /** Something can turn speech into text: the browser, or the server. */
  const canTranscribe = hasRecognition || serverStt;

  const clearTimers = useCallback(() => {
    for (const t of [silenceTimer, noSpeechTimer, maxTimer]) {
      if (t.current !== null) window.clearTimeout(t.current);
      t.current = null;
    }
    if (vadTimer.current !== null) window.clearInterval(vadTimer.current);
    vadTimer.current = null;
    setSilenceSince(null);
  }, []);

  const releaseAudio = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    if (ctxRef.current && ctxRef.current.state !== 'closed') void ctxRef.current.close();
    ctxRef.current = null;
  }, []);

  const stopRecognition = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) return;
    rec.onend = null;
    rec.onerror = null;
    rec.onresult = null;
    try {
      rec.abort();
    } catch {
      /* already stopped */
    }
  }, []);

  const teardown = useCallback(() => {
    activeRef.current = false;
    sessionRef.current++;
    clearTimers();
    stopRecognition();
    releaseAudio();
    speakingRef.current = false;
    setStatus('off');
  }, [clearTimers, releaseAudio, stopRecognition]);

  useEffect(() => teardown, [teardown]);

  const browserText = useCallback(() => `${finalRef.current} ${interimRef.current}`.replace(/\s+/g, ' ').trim(), []);

  /** Stop the recorder and collect what it captured. */
  const collectRecording = useCallback(
    () =>
      new Promise<Blob | null>((resolve) => {
        const rec = recorderRef.current;
        recorderRef.current = null;
        if (!rec || rec.state === 'inactive') return resolve(null);
        rec.onstop = () => resolve(new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' }));
        rec.stop();
      }),
    [],
  );

  /**
   * End the session and report the answer. With server STT, the recording is transcribed and that text wins;
   * the browser's text is the fallback.
   */
  const complete = useCallback(async () => {
    if (!activeRef.current) return;
    const session = sessionRef.current;
    clearTimers();
    stopRecognition();
    const preview = browserText();
    const spoke = heardVoiceRef.current || preview !== '';

    let text = preview;
    if (serverSttRef.current && spoke) {
      const audio = await collectRecording();
      if (audio && audio.size > 0) {
        setStatus('transcribing');
        try {
          const form = new FormData();
          form.append('audio', audio);
          form.append('lang', langRef.current);
          const res = await fetch('/api/bot/stt', {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(STT_TIMEOUT_MS),
          });
          if (res.ok) {
            const data = (await res.json()) as { text?: string };
            if (data.text) text = data.text;
          }
        } catch {
          /* network or timeout: keep the browser text */
        }
      }
    }
    if (session !== sessionRef.current) return; // cancelled while transcribing
    teardown();
    if (text) callbacks.current.onHeard(text);
    else callbacks.current.onNothingHeard();
  }, [browserText, clearTimers, collectRecording, stopRecognition, teardown]);

  /** (Re)start the countdown that sends the answer once the speaker goes quiet. */
  const armSilence = useCallback(() => {
    if (silenceTimer.current !== null) window.clearTimeout(silenceTimer.current);
    setSilenceSince(performance.now());
    silenceTimer.current = window.setTimeout(() => {
      silenceTimer.current = null;
      void complete();
    }, SILENCE_MS);
  }, [complete]);

  const disarmSilence = useCallback(() => {
    if (silenceTimer.current !== null) window.clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
    setSilenceSince(null);
  }, []);

  const heardSomething = useCallback(() => {
    if (noSpeechTimer.current !== null) window.clearTimeout(noSpeechTimer.current);
    noSpeechTimer.current = null;
    if (maxTimer.current === null) maxTimer.current = window.setTimeout(() => void complete(), MAX_ANSWER_MS);
  }, [complete]);

  const startRecognition = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = languageInfo(langRef.current).bcp47;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
      let fin = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript;
        else interim += r[0].transcript;
      }
      finalRef.current = fin.trim();
      interimRef.current = interim.trim();
      setFinalText(finalRef.current);
      setInterimText(interimRef.current);
      pulseRef.current = 1;
      heardSomething();
      // Every new word restarts the countdown, so it only completes after a real pause.
      // While the level meter still hears speech, it owns the countdown instead.
      if (browserText() && !vadTalkingRef.current) armSilence();
    };
    rec.onspeechstart = () => {
      speakingRef.current = true;
    };
    rec.onspeechend = () => {
      speakingRef.current = false;
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'audio-capture' && streamRef.current && !restartedRef.current) {
        // Some Android builds can't share the mic between our recorder and recognition.
        // Give the mic to recognition; the visualiser falls back to speech events.
        restartedRef.current = true;
        releaseAudio();
        rec.onend = () => {
          if (activeRef.current) startRecognition();
        };
        return;
      }
      if (serverSttRef.current && streamRef.current) {
        // Recognition is only the preview here; the recorder still captures the answer.
        stopRecognition();
        return;
      }
      const err: VoiceError = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'blocked' : 'failed';
      teardown();
      callbacks.current.onError(err);
    };
    rec.onend = () => {
      if (!activeRef.current) return;
      // With a recorder running, our own silence detection decides when the answer ends.
      if (serverSttRef.current && recorderRef.current) return;
      void complete();
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      recRef.current = null;
    }
  }, [armSilence, browserText, complete, heardSomething, releaseAudio, stopRecognition, teardown]);

  /** Mic-level voice activity detection: marks speech, and ends the answer when there is no recognizer. */
  const startVad = useCallback(
    (endsAnswer: boolean) => {
      let floor = 0.05;
      vadTimer.current = window.setInterval(() => {
        const analyser = analyserRef.current;
        const buf = timeBuf.current;
        if (!analyser || !buf) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) {
          const d = (v - 128) / 128;
          sum += d * d;
        }
        const level = clamp((Math.sqrt(sum / buf.length) - 0.012) * 7);
        // Track the room's noise floor: drop fast, rise slowly.
        floor = level < floor ? level : floor + (level - floor) * 0.01;
        const loud = level > Math.max(SPEECH_LEVEL, floor + 0.15);
        if (loud) {
          heardVoiceRef.current = true;
          speakingRef.current = true;
          heardSomething();
          if (endsAnswer && !vadTalkingRef.current) disarmSilence();
          vadTalkingRef.current = true;
        } else if (vadTalkingRef.current) {
          vadTalkingRef.current = false;
          speakingRef.current = false;
          if (endsAnswer || browserText()) armSilence();
        }
      }, 100);
    },
    [armSilence, browserText, disarmSilence, heardSomething],
  );

  const start = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;
    const session = ++sessionRef.current;
    restartedRef.current = false;
    heardVoiceRef.current = false;
    vadTalkingRef.current = false;
    finalRef.current = '';
    interimRef.current = '';
    chunksRef.current = [];
    setFinalText('');
    setInterimText('');
    clearTimers();
    setStatus('starting');

    if (navigator.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (session !== sessionRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.55;
        ctx.createMediaStreamSource(stream).connect(analyser);
        ctxRef.current = ctx;
        analyserRef.current = analyser;
        timeBuf.current = new Uint8Array(analyser.fftSize);
        freqBuf.current = new Uint8Array(analyser.frequencyBinCount);
        if (serverSttRef.current && typeof MediaRecorder !== 'undefined') {
          const recorder = new MediaRecorder(stream);
          recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
          };
          recorder.start(250);
          recorderRef.current = recorder;
        }
      } catch (err) {
        const name = (err as DOMException)?.name;
        if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotFoundError') {
          teardown();
          callbacks.current.onError(name === 'NotFoundError' ? 'no-mic' : 'blocked');
          return;
        }
        // Otherwise carry on: recognition may still work, and the visualiser simulates levels.
      }
    }

    if (session !== sessionRef.current) return;
    startRecognition();
    if (analyserRef.current) startVad(!recRef.current || !!recorderRef.current);
    if (!recRef.current && !recorderRef.current) {
      // Nothing can transcribe: listening is visual only.
      setStatus('listening');
      return;
    }
    setStatus('listening');
    noSpeechTimer.current = window.setTimeout(() => {
      noSpeechTimer.current = null;
      if (session !== sessionRef.current || heardVoiceRef.current || browserText()) return;
      teardown();
      callbacks.current.onNothingHeard();
    }, NO_SPEECH_MS);
  }, [browserText, clearTimers, startRecognition, startVad, teardown]);

  /** Send now, without waiting for the pause. */
  const finish = useCallback(() => {
    void complete();
  }, [complete]);

  const cancel = useCallback(() => {
    teardown();
  }, [teardown]);

  /** Sample the mic. Called by the visualiser once per animation frame. */
  const sample = useCallback((out: VoiceLevels, t: number) => {
    const analyser = analyserRef.current;
    let level: number;
    let bands: [number, number, number];
    if (analyser && timeBuf.current && freqBuf.current) {
      analyser.getByteTimeDomainData(timeBuf.current);
      let sum = 0;
      for (const v of timeBuf.current) {
        const d = (v - 128) / 128;
        sum += d * d;
      }
      const rms = Math.sqrt(sum / timeBuf.current.length);
      level = clamp((rms - 0.012) * 7);
      analyser.getByteFrequencyData(freqBuf.current);
      bands = [band(freqBuf.current, 1, 5), band(freqBuf.current, 5, 18), band(freqBuf.current, 18, 56)];
    } else {
      // No direct mic access: animate from speech events.
      pulseRef.current *= 0.92;
      const talk = speakingRef.current ? 0.35 + 0.25 * Math.abs(Math.sin(t * 7.1) * Math.sin(t * 3.3)) : 0;
      level = clamp(talk + pulseRef.current * 0.35);
      bands = [clamp(level * (0.8 + 0.2 * Math.sin(t * 2))), clamp(level * (0.9 + 0.3 * Math.sin(t * 3.7))), clamp(level * 0.7)];
    }
    const k = (target: number, cur: number) => cur + (target - cur) * (target > cur ? 0.35 : 0.07);
    out.level = k(level, out.level);
    out.bands = [k(bands[0], out.bands[0]), k(bands[1], out.bands[1]), k(bands[2], out.bands[2])];
  }, []);

  return { status, finalText, interimText, canTranscribe, silenceSince, start, finish, cancel, sample };
}

function clamp(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function band(buf: Uint8Array, from: number, to: number) {
  let s = 0;
  for (let i = from; i < to && i < buf.length; i++) s += buf[i];
  return clamp((s / (to - from) / 255 - 0.12) * 1.9);
}
