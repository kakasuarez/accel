'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccelMark } from '@/components/AccelMark';
import { api, ApiFailure } from '@/components/api';
import { ACKNOWLEDGEMENTS, CLOSING_MESSAGE, GREETING, WELCOME_BACK, pickAcknowledgement } from '@/lib/bot/script';
import { BotExplanation } from './BotExplanation';
import { BotResult } from './BotResult';
import type { AnswerResult, BundleChoice, CustomerLead, IntakeState, LeadState, PublicQuestion } from './types';
import { VoiceAurora } from './VoiceAurora';
import { useBotSpeech } from './useBotSpeech';
import { SILENCE_MS, useVoice, type VoiceError } from './useVoice';
import { WordReveal, type RevealLine } from './WordReveal';

/** Which server speech features are configured (see /api/bot/config). */
interface SpeechConfig {
  tts: boolean;
  stt: boolean;
}

/** The backend asks 8 profile questions, then up to 4 about add-ons; it can finish sooner. */
const PROFILE_TOTAL = 8;
const ADD_ON_MAX = 4;
const LEAVE_MS = 240;
/** How long the composer glows after the bot finishes reading the question ("your turn"). Matches `bot-turn-glow` in bot.css. */
const TURN_GLOW_MS = 3500;
/** Above this many options, chips are filtered by what's typed and the rest sit behind "Show all". */
const CHIP_LIMIT = 8;
const SKIP_LABEL = 'Not sure';

const VOICE_ERRORS: Record<VoiceError, string> = {
  blocked: 'Microphone access is blocked. Allow it in your browser settings, or type your answer.',
  'no-mic': 'No microphone was found on this device. Type your answer instead.',
  failed: 'Voice input stopped unexpectedly. Try again, or type your answer.',
};

/** The line shown (and spoken) above the question: greeting, acknowledgement or "I couldn't tell…". */
interface Intro {
  text: string;
  tone: 'greet' | 'ack' | 'unclear';
}

type Load = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

function placeholderFor(q: PublicQuestion | null): string {
  if (!q) return 'Type your answer';
  if (q.type === 'integer' || q.type === 'number') return q.unit ? `Type a number (${q.unit})` : 'Type a number';
  if (q.options && q.options.length > CHIP_LIMIT) return 'Type or pick an answer';
  return 'Type your answer';
}

export function AccelBot({ leadId }: { leadId: string | null }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [intake, setIntake] = useState<IntakeState | null>(null);
  const [accepted, setAccepted] = useState<CustomerLead | null>(null);
  const [intro, setIntro] = useState<Intro | null>(null);
  const [turn, setTurn] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [voiceOn, setVoiceOn] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [bundleTier, setBundleTier] = useState<BundleChoice['tier']>('recommended');
  // A different lead starts again from its Recommended bundle (BotResult is keyed by lead, so it resets too).
  const currentLeadId = intake?.leadId;
  useEffect(() => setBundleTier('recommended'), [currentLeadId]);
  const [showAllChips, setShowAllChips] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const lastAck = useRef<string | undefined>(undefined);
  const intakeRef = useRef<IntakeState | null>(null);
  intakeRef.current = intake;

  const question = intake?.nextQuestion ?? null;
  const done = load.kind === 'ready' && !accepted && !!intake && !question;
  const asking = load.kind === 'ready' && !accepted && !!question;
  const answeredCount = intake ? Object.keys(intake.answers).length : 0;

  // ---------- Loading the conversation ----------
  const loadedFor = useRef<string | null>(null);
  const stopSpeech = useRef<() => void>(() => {});
  const loadSeq = useRef(0);

  const applyState = useCallback((state: IntakeState, lead: CustomerLead | null, first: Intro | null) => {
    setIntake(state);
    setAccepted(lead?.quote ? lead : null);
    setIntro(first);
    setRevealed(false);
    setPending(null);
    setLeaving(false);
    setShowResult(false);
    setShowAllChips(false);
    setTurn((t) => t + 1);
  }, []);

  /** Re-read the lead from the server, e.g. after a 409 says the screen is out of date. */
  const refetch = useCallback(
    async (id: string) => {
      const seq = ++loadSeq.current;
      try {
        const state = await api<LeadState>(`/api/leads/${encodeURIComponent(id)}`);
        if (seq !== loadSeq.current) return;
        applyState(state, state.lead, null);
        setLoad({ kind: 'ready' });
      } catch (err) {
        if (seq !== loadSeq.current) return;
        setLoad({ kind: 'error', message: err instanceof ApiFailure && err.status === 404 ? 'We couldn’t find that conversation.' : (err as Error).message });
      }
    },
    [applyState],
  );

  useEffect(() => {
    const key = leadId ?? 'new';
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    // Arriving at ?lead= right after creating that lead: the state is already on screen.
    if (leadId && intakeRef.current?.leadId === leadId) return;

    const seq = ++loadSeq.current;
    stopSpeech.current();
    setLoad({ kind: 'loading' });
    setNotice(null);
    setDraft('');
    lastAck.current = undefined;

    if (!leadId) {
      api<IntakeState>('/api/leads', { method: 'POST' })
        .then((state) => {
          if (seq !== loadSeq.current) return;
          loadedFor.current = state.leadId;
          applyState(state, null, { text: GREETING, tone: 'greet' });
          setLoad({ kind: 'ready' });
          router.replace(`/bot?lead=${encodeURIComponent(state.leadId)}`, { scroll: false });
        })
        .catch((err: Error) => seq === loadSeq.current && setLoad({ kind: 'error', message: err.message }));
      return;
    }

    api<LeadState>(`/api/leads/${encodeURIComponent(leadId)}`)
      .then((state) => {
        if (seq !== loadSeq.current) return;
        const started = Object.keys(state.answers).length > 0;
        const first: Intro | null = state.nextQuestion ? { text: started ? WELCOME_BACK : GREETING, tone: 'greet' } : null;
        applyState(state, state.lead, first);
        setLoad({ kind: 'ready' });
      })
      .catch((err) => {
        if (seq !== loadSeq.current) return;
        setLoad({
          kind: 'error',
          message: err instanceof ApiFailure && err.status === 404 ? 'We couldn’t find that conversation.' : (err as Error).message,
        });
      });
  }, [leadId, applyState, router]);

  // ---------- Speech ----------
  const [voicePause, setVoicePause] = useState<string | null>(null);
  const emptyRuns = useRef(0);
  const submitRef = useRef<(answer: string) => void>(() => {});

  const [config, setConfig] = useState<SpeechConfig | null>(null);
  useEffect(() => {
    fetch('/api/bot/config')
      .then((r) => (r.ok ? (r.json() as Promise<SpeechConfig>) : null))
      .catch(() => null)
      .then((c) => setConfig(c ?? { tts: false, stt: false }));
  }, []);

  const speech = useBotSpeech(config?.tts ?? false);
  stopSpeech.current = speech.stop;

  const voice = useVoice({
    serverStt: config?.stt ?? false,
    onHeard: (text) => {
      emptyRuns.current = 0;
      submitRef.current(text);
    },
    onNothingHeard: () => {
      emptyRuns.current += 1;
      // Listen once more, then pause so the mic is never left open indefinitely.
      if (emptyRuns.current >= 2) setVoicePause('I didn’t hear anything, so I’ve paused the microphone.');
    },
    onError: (err) => {
      if (err === 'failed') {
        setVoicePause('The microphone stopped. Tap to speak again.');
        return;
      }
      setVoiceOn(false);
      setNotice(VOICE_ERRORS[err]);
    },
  });

  // "Your turn": when the read-out ends on its own in typing mode, the composer glows briefly.
  // Read-outs cut short (send, mic tap, mute) end in the same update that sets `pending`, `voiceOn`
  // or `muted`, so they never glow. Muted speech never starts, so it has no end to glow on.
  const [turnGlow, setTurnGlow] = useState(0);
  const [wasSpeaking, setWasSpeaking] = useState(speech.speaking);
  if (wasSpeaking !== speech.speaking) {
    setWasSpeaking(speech.speaking);
    if (wasSpeaking && !voiceOn && asking && !pending && !leaving && !speech.muted) setTurnGlow((n) => n + 1);
  }
  useEffect(() => {
    if (!turnGlow) return;
    const t = window.setTimeout(() => setTurnGlow(0), TURN_GLOW_MS);
    return () => window.clearTimeout(t);
  }, [turnGlow]);

  const reducedMotion = useRef(false);
  useEffect(() => {
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // What the bot says on this turn. Each line is spoken exactly as written, so pre-generated clips match.
  const questionText = question?.question;
  const lines = useMemo<RevealLine[]>(() => {
    if (done) return [{ text: CLOSING_MESSAGE }];
    if (!questionText) return [];
    const out: RevealLine[] = [];
    if (intro) out.push({ text: intro.text, className: intro.tone === 'unclear' ? 'bot-ack is-unclear' : 'bot-ack' });
    out.push({ text: questionText, className: 'bot-question-text' });
    return out;
    // `turn` restarts the line set when the same question is asked again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, questionText, intro, turn]);

  const onRevealed = useCallback(() => {
    setRevealed(true);
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus({ preventScroll: true });
  }, []);

  const { prefetch, speak } = speech;
  useEffect(() => {
    if (config) prefetch([...ACKNOWLEDGEMENTS, CLOSING_MESSAGE]);
  }, [config, prefetch]);

  useEffect(() => {
    if (config && lines.length > 0) void speak(lines.map((l) => l.text));
  }, [config, lines, speak]);

  // ---------- Answering ----------
  const submit = useCallback(
    async (raw: string) => {
      const text = raw.replace(/\s+/g, ' ').trim().slice(0, 1000);
      const q = intakeRef.current?.nextQuestion;
      const id = intakeRef.current?.leadId;
      if (!text || !q || !id || pending || leaving) return;
      setNotice(null);
      setPending(text);
      speech.stop();
      try {
        const res = await api<AnswerResult>(`/api/leads/${encodeURIComponent(id)}/answers`, {
          method: 'POST',
          json: { questionId: q.id, answer: text },
        });
        if (res.status === 'unclear') {
          // Same question again, with the reason first. The typed text stays so it can be corrected.
          emptyRuns.current = 0;
          applyState(res, null, { text: res.reason, tone: 'unclear' });
          return;
        }
        setLeaving(true);
        await wait(reducedMotion.current ? 0 : LEAVE_MS);
        let ack: Intro | null = null;
        if (res.nextQuestion) {
          const line = pickAcknowledgement(lastAck.current);
          lastAck.current = line;
          ack = { text: line, tone: 'ack' };
        }
        setDraft('');
        applyState(res, null, ack);
      } catch (err) {
        setPending(null);
        setLeaving(false);
        if (err instanceof ApiFailure && (err.code === 'wrong_question' || err.code === 'already_accepted')) {
          await refetch(id);
          return;
        }
        setNotice(err instanceof ApiFailure ? err.message : 'Something went wrong. Please try again.');
        if (!voiceOn) setDraft(text);
      }
    },
    [pending, leaving, speech, applyState, refetch, voiceOn],
  );
  submitRef.current = (t) => void submit(t);

  // In voice mode, start listening once the question has appeared and finished being read out.
  useEffect(() => {
    if (voiceOn && asking && revealed && !speech.speaking && !leaving && !pending && !voicePause && voice.status === 'off')
      void voice.start();
  }, [voiceOn, asking, revealed, speech.speaking, leaving, pending, voicePause, voice]);

  // Voice mode ends with the questions.
  useEffect(() => {
    if (!asking && voiceOn) {
      voice.cancel();
      setVoiceOn(false);
    }
  }, [asking, voiceOn, voice]);

  const startVoice = () => {
    setNotice(null);
    setVoicePause(null);
    emptyRuns.current = 0;
    setVoiceOn(true);
    // Tapping the mic means "I want to answer now": cut the read-out short.
    speech.stop();
    // Start inside the tap (a user gesture) when the question is already on screen.
    if (revealed && !leaving && !pending) void voice.start();
  };

  const exitVoice = useCallback(() => {
    voice.cancel();
    setVoiceOn(false);
    setVoicePause(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [voice]);

  const resumeVoice = () => {
    emptyRuns.current = 0;
    setVoicePause(null);
    void voice.start();
  };

  /** Send what has been heard so far without waiting for the pause. */
  const sendNow = () => voice.finish();

  useEffect(() => {
    if (!voiceOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitVoice();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voiceOn, exitVoice]);

  // ---------- Chips ----------
  const chips = useMemo(() => {
    if (!question) return { shown: [] as string[], hidden: 0 };
    const labels = (question.options ?? []).map((o) => o.label);
    const hasSkip = labels.some((l) => l.toLowerCase() === SKIP_LABEL.toLowerCase());
    const skip = question.canSkip && !hasSkip ? [SKIP_LABEL] : [];
    if (labels.length <= CHIP_LIMIT || showAllChips) return { shown: [...labels, ...skip], hidden: 0 };
    const typed = draft.trim().toLowerCase();
    if (typed) {
      const matches = labels.filter((l) => l.toLowerCase().includes(typed));
      return { shown: [...matches.slice(0, CHIP_LIMIT), ...skip], hidden: 0 };
    }
    return { shown: [...labels.slice(0, CHIP_LIMIT), ...skip], hidden: labels.length - CHIP_LIMIT };
  }, [question, showAllChips, draft]);

  // ---------- Header ----------
  const phase = question?.phase;
  const countText = accepted
    ? 'Quote accepted'
    : done
      ? 'Your bundle'
      : load.kind !== 'ready' || !phase
        ? ''
        : phase === 'profile'
          ? `${Math.min(answeredCount + 1, PROFILE_TOTAL)} of ${PROFILE_TOTAL}`
          : `Add-ons ${Math.min(answeredCount - PROFILE_TOTAL + 1, ADD_ON_MAX)} of ${ADD_ON_MAX}`;
  const progressTotal = PROFILE_TOTAL + ADD_ON_MAX;
  const progressDone = done || accepted ? progressTotal : Math.min(answeredCount, progressTotal);

  const voiceStatusText = !voice.canTranscribe
    ? 'This browser can’t turn speech into text yet'
    : pending
      ? 'Checking'
      : voicePause
        ? 'Paused'
        : voice.status === 'listening'
          ? 'Listening'
          : voice.status === 'transcribing'
            ? 'Transcribing'
            : voice.status === 'starting'
              ? 'Starting the microphone…'
              : speech.speaking
                ? 'Speaking'
                : 'Next question';

  const heard = pending ?? `${voice.finalText} ${voice.interimText}`.trim();
  const numeric = question?.type === 'integer' ? 'numeric' : question?.type === 'number' ? 'decimal' : undefined;

  return (
    <div className={`bot${voiceOn ? ' is-voice' : ''}${done ? ' is-done' : ''}`}>
      <header className="bot-header">
        <div className="bot-header-row">
          <Link href="/dashboard" className="bot-brand" aria-label="Accel Business dashboard">
            <AccelMark className="bot-orb" />
            <span>Accel Bot</span>
          </Link>
          <span className="bot-count" aria-live="polite">
            {countText}
          </span>
          <button
            type="button"
            className="bot-icon-btn"
            onClick={speech.toggleMute}
            aria-pressed={speech.muted}
            aria-label={speech.muted ? 'Unmute Accel Bot’s voice' : 'Mute Accel Bot’s voice'}
            title={speech.muted ? 'Unmute voice' : 'Mute voice'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
              {speech.muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" />}
            </svg>
          </button>
          <Link href="/dashboard" className="bot-header-link">
            Dashboard
          </Link>
        </div>
        <div
          className="bot-progress"
          role="progressbar"
          aria-label="Questions answered"
          aria-valuemin={0}
          aria-valuemax={progressTotal}
          aria-valuenow={progressDone}
        >
          {Array.from({ length: progressTotal }, (_, i) => (
            <span
              key={i}
              className={[
                i === PROFILE_TOTAL ? 'is-group' : '',
                i < progressDone ? 'is-done' : asking && i === answeredCount ? 'is-current' : '',
              ]
                .filter(Boolean)
                .join(' ') || undefined}
            />
          ))}
        </div>
      </header>

      <main className="bot-main">
        {/* The stage remounts every turn; this region stays put so screen readers announce each new line. */}
        <p className="sr-only" aria-live="polite">
          {asking ? lines.map((l) => l.text).join(' ') : ''}
        </p>
        {load.kind === 'loading' && (
          <section className="bot-stage" aria-busy="true">
            <p className="bot-loading" role="status">
              <span className="bot-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="sr-only">Loading your conversation</span>
            </p>
          </section>
        )}

        {load.kind === 'error' && (
          <section className="bot-stage bot-state" aria-labelledby="bot-error">
            <h1 id="bot-error" className="bot-closing">
              {load.message}
            </h1>
            <div className="bundle-actions">
              <Link href="/bot?new=1" className="btn btn-primary">
                Start a new conversation
              </Link>
              <Link href="/dashboard" className="btn btn-outline-dark">
                Go to your dashboard
              </Link>
            </div>
          </section>
        )}

        {accepted && (
          <section className="bot-stage bot-state" aria-labelledby="bot-accepted">
            <h1 id="bot-accepted" className="bot-closing">
              You’ve already accepted this bundle.
            </h1>
            <p className="bot-state-body">Your quote is saved. Next, verify your business from your dashboard.</p>
            <div className="bundle-actions">
              <Link href="/dashboard" className="btn btn-primary">
                Go to your dashboard
              </Link>
              <Link href="/bot?new=1" className="btn btn-outline-dark">
                Start a new request
              </Link>
            </div>
          </section>
        )}

        {asking && question && (
          <section className={`bot-stage${leaving ? ' is-leaving' : ''}${pending ? ' is-pending' : ''}`} key={turn} aria-labelledby="bot-q">
            {answeredCount > 0 ? (
              <Link href="/bot?new=1" className="bot-back">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" />
                </svg>
                Start over
              </Link>
            ) : (
              <div className="bot-back" aria-hidden="true" />
            )}
            <h1 id="bot-q" className={`bot-question${question.question.length > 80 ? ' is-long' : ''}`}>
              <WordReveal lines={lines} onDone={onRevealed} />
            </h1>

            {chips.shown.length > 0 && (
              <ul className={`bot-suggestions${revealed ? ' is-in' : ''}`} aria-label="Suggested answers">
                {chips.shown.map((label, i) => (
                  <li key={label} style={{ transitionDelay: revealed ? `${Math.min(i, 12) * 40}ms` : '0ms' }}>
                    <button
                      type="button"
                      className={`bot-chip${pending === label ? ' is-picked' : ''}`}
                      onClick={() => void submit(label)}
                      tabIndex={revealed ? 0 : -1}
                      disabled={!!pending}
                    >
                      {label}
                    </button>
                  </li>
                ))}
                {chips.hidden > 0 && (
                  <li style={{ transitionDelay: revealed ? `${Math.min(chips.shown.length, 12) * 40}ms` : '0ms' }}>
                    <button
                      type="button"
                      className="bot-chip bot-chip-more"
                      onClick={() => setShowAllChips(true)}
                      tabIndex={revealed ? 0 : -1}
                      disabled={!!pending}
                    >
                      Show all {chips.hidden + CHIP_LIMIT}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </section>
        )}

        {done && intake?.recommendation && (
          <section className="bot-result" aria-labelledby="bot-closing">
            <div className="bot-result-lead">
              <h1 id="bot-closing" className="bot-closing">
                <WordReveal lines={lines} stagger={45} onDone={() => setShowResult(true)} />
              </h1>
              <div className={`bot-result-explain${showResult ? ' is-in' : ''}`}>
                <BotExplanation key={intake.leadId} leadId={intake.leadId} tier={bundleTier} explanation={intake.explanation} />
              </div>
            </div>
            <div className={`bot-result-body${showResult ? ' is-in' : ''}`}>
              <BotResult
                key={intake.leadId}
                leadId={intake.leadId}
                bundles={
                  intake.bundles ?? [{ tier: 'recommended', label: 'Recommended', comparison: null, recommendation: intake.recommendation }]
                }
                onTierChange={setBundleTier}
                onAlreadyAccepted={() => void refetch(intake.leadId)}
              />
            </div>
          </section>
        )}

        {done && !intake?.recommendation && (
          <section className="bot-stage bot-state" aria-labelledby="bot-norec">
            <h1 id="bot-norec" className="bot-closing">
              We couldn’t put a bundle together from these answers.
            </h1>
            <div className="bundle-actions">
              <Link href="/bot?new=1" className="btn btn-primary">
                Start over
              </Link>
            </div>
          </section>
        )}
      </main>

      {asking && (
        <div className="bot-dock">
          {voiceOn ? (
            <div className="bot-voice" role="group" aria-label="Voice answer">
              <VoiceAurora sample={voice.sample} />
              <p className={`bot-voice-status${voicePause && !pending ? ' is-paused' : ''}`} aria-live="polite">
                {voiceStatusText}
              </p>
              <p className="bot-voice-text" aria-live="polite">
                {pending ? (
                  pending
                ) : (
                  heard &&
                  !voicePause && (
                    <>
                      {voice.finalText} <span className="bot-voice-interim">{voice.interimText}</span>
                    </>
                  )
                )}
              </p>
              <div className="bot-voice-actions">
                <button
                  type="button"
                  className="bot-round bot-round-ghost"
                  onClick={exitVoice}
                  aria-label="Exit voice mode"
                  title="Exit voice mode and type"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="2.5" y="6" width="19" height="12" rx="2" />
                    <path d="M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01M6.5 14.5h11" />
                  </svg>
                </button>
                {voicePause && !pending ? (
                  <button type="button" className="bot-round bot-round-solid" onClick={resumeVoice} aria-label="Tap to speak">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5.5 11a6.5 6.5 0 0013 0M12 17.5V21" />
                    </svg>
                  </button>
                ) : (
                  voice.canTranscribe && (
                    <button
                      type="button"
                      className="bot-round bot-round-solid"
                      onClick={sendNow}
                      disabled={!heard || !!pending}
                      aria-label="Send answer now"
                    >
                      {voice.silenceSince !== null && !pending && (
                        <svg key={voice.silenceSince} className="bot-countdown" viewBox="0 0 64 64" aria-hidden="true">
                          <circle cx="32" cy="32" r="30" style={{ animationDuration: `${SILENCE_MS}ms` }} />
                        </svg>
                      )}
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    </button>
                  )
                )}
              </div>
            </div>
          ) : (
            <>
              {pending ? (
                <p className="bot-pending" role="status">
                  <span className="bot-dots" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                  Checking your answer
                </p>
              ) : (
                notice && (
                  <p className="bot-notice" role="status">
                    {notice}
                  </p>
                )
              )}
              <form
                className="bot-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit(draft);
                }}
              >
                {turnGlow > 0 && !pending && <span key={turnGlow} className="bot-turn-glow" aria-hidden="true" />}
                <label htmlFor="bot-input" className="sr-only">
                  Your answer
                </label>
                <input
                  id="bot-input"
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={placeholderFor(question)}
                  autoComplete="off"
                  enterKeyHint="send"
                  inputMode={numeric}
                  maxLength={1000}
                  readOnly={!!pending}
                />
                <button type="button" className="bot-icon-btn" onClick={startVoice} aria-label="Answer by voice" disabled={!!pending}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5.5 11a6.5 6.5 0 0013 0M12 17.5V21" />
                  </svg>
                </button>
                <button type="submit" className="bot-send" disabled={!draft.trim() || !!pending} aria-label="Send answer">
                  {pending ? (
                    <span className="bot-send-spin" aria-hidden="true" />
                  ) : (
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
