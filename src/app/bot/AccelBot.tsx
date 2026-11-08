'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccelMark } from '@/components/AccelMark';
import { api, ApiFailure } from '@/components/api';
import { ArrowIcon } from '@/components/icons';
import { DEFAULT_LANG, isLang, LANGUAGES, languageInfo, type Lang, type LanguageInfo } from '@/lib/i18n/languages';
import { scriptFor, uiText, unitText, type UiKey } from '@/lib/i18n/ui';
import { BotExplanation } from './BotExplanation';
import { BotResult } from './BotResult';
import { BotLanguageProvider } from './i18n';
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
/** The language picked last time, preselected in the picker. A convenience only: the lead holds the real choice. */
const LANGUAGE_KEY = 'accel-bot-language';

function savedLanguage(): Lang | null {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_KEY);
    return isLang(saved) ? saved : null;
  } catch {
    return null;
  }
}

function saveLanguage(lang: Lang) {
  try {
    window.localStorage.setItem(LANGUAGE_KEY, lang);
  } catch {
    /* private mode or blocked storage: nothing to remember */
  }
}

/** The acknowledgement before the next question: never the same one twice in a row. */
function pickAcknowledgement(pool: readonly string[], previous?: string): string {
  const options = pool.filter((a) => a !== previous);
  return options[Math.floor(Math.random() * options.length)]!;
}

const VOICE_ERRORS: Record<VoiceError, UiKey> = {
  blocked: 'voiceError.blocked',
  'no-mic': 'voiceError.no-mic',
  failed: 'voiceError.failed',
};

/** The line shown (and spoken) above the question: greeting, acknowledgement or "I couldn't tell…". */
interface Intro {
  text: string;
  tone: 'greet' | 'ack' | 'unclear';
}

/** `consent`: a brand-new conversation waiting for the privacy note to be accepted; nothing is created yet. */
type Load = { kind: 'consent' } | { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; message: string };

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

function placeholderFor(q: PublicQuestion | null, lang: Lang): string {
  const t = (key: UiKey, vars?: Record<string, string>) => uiText(lang, key, vars);
  if (!q) return t('placeholder.answer');
  if (q.type === 'integer' || q.type === 'number') return q.unit ? t('placeholder.numberUnit', { unit: unitText(lang, q.unit) }) : t('placeholder.number');
  if (q.options && q.options.length > CHIP_LIMIT) return t('placeholder.pick');
  return t('placeholder.answer');
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
  /**
   * The customer has continued past the privacy note on this page. It holds for the rest of the visit,
   * so "Start over" doesn't ask again; a fresh page load asks again before anything is created or spoken.
   */
  const [agreed, setAgreed] = useState(false);
  const agreedRef = useRef(false);
  /**
   * The conversation's language. Before a lead exists it is the customer's pick (or last visit's, preselected);
   * after that it is the lead's. Picked once per visit, like the privacy note.
   */
  const [lang, setLang] = useState<Lang>(DEFAULT_LANG);
  const langRef = useRef<Lang>(DEFAULT_LANG);
  langRef.current = lang;
  const [languageChosen, setLanguageChosen] = useState(false);
  const languageChosenRef = useRef(false);
  /** A language from the list that isn't available yet, tapped in the picker. */
  const [comingSoon, setComingSoon] = useState<LanguageInfo | null>(null);
  const t = useCallback((key: UiKey, vars?: Record<string, string | number>) => uiText(lang, key, vars), [lang]);
  const script = useMemo(() => scriptFor(lang), [lang]);

  const inputRef = useRef<HTMLInputElement>(null);
  const lastAck = useRef<string | undefined>(undefined);
  const intakeRef = useRef<IntakeState | null>(null);
  intakeRef.current = intake;

  const question = intake?.nextQuestion ?? null;
  const answeredCount = intake ? Object.keys(intake.answers).length : 0;
  // The note comes before the first question: for a new conversation (not created until the customer continues)
  // and for a saved one with no answers yet. A conversation with answers resumes straight away.
  const needsConsent =
    !agreed && (load.kind === 'consent' || (load.kind === 'ready' && !accepted && !!question && answeredCount === 0));
  // The language is picked first, then the privacy note is shown in it.
  const needsLanguage = needsConsent && !languageChosen;
  const done = load.kind === 'ready' && !accepted && !!intake && !question;
  const asking = load.kind === 'ready' && !accepted && !!question && !needsConsent;

  // ---------- Loading the conversation ----------
  const loadedFor = useRef<string | null>(null);
  const stopSpeech = useRef<() => void>(() => {});
  const loadSeq = useRef(0);

  useEffect(() => {
    const saved = savedLanguage();
    if (saved && !languageChosenRef.current && !intakeRef.current) setLang(saved);
  }, []);

  /** A server error in the customer's language. Server messages are English, so other languages get a plain one. */
  const errorText = useCallback((err: unknown, notFound?: UiKey): string => {
    const language = langRef.current;
    if (err instanceof ApiFailure && err.status === 404 && notFound) return uiText(language, notFound);
    if (err instanceof ApiFailure && err.code === 'network') return uiText(language, 'error.network');
    if (language === 'en' && err instanceof Error && err.message) return err.message;
    return uiText(language, 'error.generic');
  }, []);

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
        setLoad({ kind: 'error', message: errorText(err, 'error.notFound') });
      }
    },
    [applyState, errorText],
  );

  /** Create the conversation. Only called once the customer has agreed to the privacy note. */
  const createLead = useCallback(
    (seq: number) => {
      api<IntakeState>('/api/leads', { method: 'POST', json: { language: langRef.current } })
        .then((state) => {
          if (seq !== loadSeq.current) return;
          loadedFor.current = state.leadId;
          setLang(state.language);
          applyState(state, null, { text: scriptFor(state.language).greeting, tone: 'greet' });
          setLoad({ kind: 'ready' });
          router.replace(`/bot?lead=${encodeURIComponent(state.leadId)}`, { scroll: false });
        })
        .catch((err: Error) => seq === loadSeq.current && setLoad({ kind: 'error', message: errorText(err) }));
    },
    [applyState, router, errorText],
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
      // Nothing is created until the customer has seen the privacy note and continued.
      if (agreedRef.current) createLead(seq);
      else setLoad({ kind: 'consent' });
      return;
    }

    api<LeadState>(`/api/leads/${encodeURIComponent(leadId)}`)
      .then((state) => {
        if (seq !== loadSeq.current) return;
        const started = Object.keys(state.answers).length > 0;
        // A conversation with answers keeps its language. One with none yet takes the customer's pick, if made.
        const language = started || !languageChosenRef.current ? state.language : langRef.current;
        setLang(language);
        const lines = scriptFor(language);
        const first: Intro | null = state.nextQuestion ? { text: started ? lines.welcomeBack : lines.greeting, tone: 'greet' } : null;
        applyState(state, state.lead, first);
        setLoad({ kind: 'ready' });
      })
      .catch((err) => {
        if (seq !== loadSeq.current) return;
        setLoad({ kind: 'error', message: errorText(err, 'error.notFound') });
      });
  }, [leadId, applyState, createLead, errorText]);

  /** A language from the picker. One that isn't available yet only says so. */
  const chooseLanguage = (info: LanguageInfo) => {
    if (!info.available || !isLang(info.code)) {
      setComingSoon(info);
      return;
    }
    setComingSoon(null);
    saveLanguage(info.code);
    setLang(info.code);
    languageChosenRef.current = true;
    setLanguageChosen(true);
  };

  const changeLanguage = () => {
    languageChosenRef.current = false;
    setLanguageChosen(false);
  };

  /** "Let's start": record the agreement, then create the conversation if it doesn't exist yet. */
  const agree = () => {
    agreedRef.current = true;
    setAgreed(true);
    if (load.kind === 'consent') {
      const seq = ++loadSeq.current;
      setLoad({ kind: 'loading' });
      createLead(seq);
      return;
    }
    const current = intakeRef.current;
    if (!current || Object.keys(current.answers).length > 0) return;
    // A saved conversation with no answers yet: greet in the language picked here, switching the lead if needed.
    if (current.language === lang) {
      setIntro({ text: script.greeting, tone: 'greet' });
      return;
    }
    const seq = ++loadSeq.current;
    setLoad({ kind: 'loading' });
    api<LeadState>(`/api/leads/${encodeURIComponent(current.leadId)}`, { method: 'PATCH', json: { language: lang } })
      .then((state) => {
        if (seq !== loadSeq.current) return;
        setLang(state.language);
        applyState(state, state.lead, { text: scriptFor(state.language).greeting, tone: 'greet' });
        setLoad({ kind: 'ready' });
      })
      .catch((err) => seq === loadSeq.current && setLoad({ kind: 'error', message: errorText(err) }));
  };

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

  const speech = useBotSpeech(config?.tts ?? false, lang);
  stopSpeech.current = speech.stop;

  const voice = useVoice({
    serverStt: config?.stt ?? false,
    lang,
    onHeard: (text) => {
      emptyRuns.current = 0;
      submitRef.current(text);
    },
    onNothingHeard: () => {
      emptyRuns.current += 1;
      // Listen once more, then pause so the mic is never left open indefinitely.
      if (emptyRuns.current >= 2) setVoicePause(uiText(langRef.current, 'voice.nothingHeard'));
    },
    onError: (err) => {
      if (err === 'failed') {
        setVoicePause(uiText(langRef.current, 'voice.stopped'));
        return;
      }
      setVoiceOn(false);
      setNotice(uiText(langRef.current, VOICE_ERRORS[err]));
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
    if (done) return [{ text: script.closing }];
    // Nothing is shown or spoken until the customer continues past the privacy note.
    if (!questionText || needsConsent) return [];
    const out: RevealLine[] = [];
    if (intro) out.push({ text: intro.text, className: intro.tone === 'unclear' ? 'bot-ack is-unclear' : 'bot-ack' });
    out.push({ text: questionText, className: 'bot-question-text' });
    return out;
    // `turn` restarts the line set when the same question is asked again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, questionText, intro, turn, needsConsent, script]);

  const onRevealed = useCallback(() => {
    setRevealed(true);
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus({ preventScroll: true });
  }, []);

  const { prefetch, speak } = speech;
  useEffect(() => {
    if (config && languageChosen) prefetch([...script.acknowledgements, script.closing]);
  }, [config, prefetch, script, languageChosen]);

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
          const line = pickAcknowledgement(scriptFor(langRef.current).acknowledgements, lastAck.current);
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
        setNotice(errorText(err));
        if (!voiceOn) setDraft(text);
      }
    },
    [pending, leaving, speech, applyState, refetch, voiceOn, errorText],
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
    const skipLabel = question.skipLabel ?? t('skip');
    const hasSkip = labels.some((l) => l.toLowerCase() === skipLabel.toLowerCase());
    const skip = question.canSkip && !hasSkip ? [skipLabel] : [];
    if (labels.length <= CHIP_LIMIT || showAllChips) return { shown: [...labels, ...skip], hidden: 0 };
    const typed = draft.trim().toLowerCase();
    if (typed) {
      const matches = labels.filter((l) => l.toLowerCase().includes(typed));
      return { shown: [...matches.slice(0, CHIP_LIMIT), ...skip], hidden: 0 };
    }
    return { shown: [...labels.slice(0, CHIP_LIMIT), ...skip], hidden: labels.length - CHIP_LIMIT };
  }, [question, showAllChips, draft, t]);

  // ---------- Header ----------
  const phase = question?.phase;
  const countText = accepted
    ? t('count.accepted')
    : done
      ? t('count.bundle')
      : load.kind !== 'ready' || !phase || needsConsent
        ? ''
        : phase === 'profile'
          ? t('count.profile', { n: Math.min(answeredCount + 1, PROFILE_TOTAL), total: PROFILE_TOTAL })
          : t('count.addOns', { n: Math.min(answeredCount - PROFILE_TOTAL + 1, ADD_ON_MAX), total: ADD_ON_MAX });
  const progressTotal = PROFILE_TOTAL + ADD_ON_MAX;
  const progressDone = done || accepted ? progressTotal : Math.min(answeredCount, progressTotal);

  const voiceStatusText = t(
    !voice.canTranscribe
      ? 'voice.unsupported'
      : pending
        ? 'voice.checking'
        : voicePause
          ? 'voice.paused'
          : voice.status === 'listening'
            ? 'voice.listening'
            : voice.status === 'transcribing'
              ? 'voice.transcribing'
              : voice.status === 'starting'
                ? 'voice.starting'
                : speech.speaking
                  ? 'voice.speaking'
                  : 'voice.next',
  );

  const heard = pending ?? `${voice.finalText} ${voice.interimText}`.trim();
  const numeric = question?.type === 'integer' ? 'numeric' : question?.type === 'number' ? 'decimal' : undefined;

  return (
    <BotLanguageProvider value={lang}>
    <div className={`bot${voiceOn ? ' is-voice' : ''}${done ? ' is-done' : ''}`} lang={languageInfo(lang).bcp47}>
      <header className="bot-header">
        <div className="bot-header-row">
          <Link href="/dashboard" className="bot-brand" aria-label={t('header.home')}>
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
            aria-label={t(speech.muted ? 'header.unmute' : 'header.mute')}
            title={t(speech.muted ? 'header.unmuteTitle' : 'header.muteTitle')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
              {speech.muted ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" />}
            </svg>
          </button>
          <Link href="/dashboard" className="bot-header-link">
            {t('header.dashboard')}
          </Link>
        </div>
        <div
          className="bot-progress"
          role="progressbar"
          aria-label={t('header.progress')}
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
              <span className="sr-only">{t('loading')}</span>
            </p>
          </section>
        )}

        {needsLanguage && (
          <section className="bot-stage bot-state bot-language" aria-labelledby="bot-language">
            {/* Asked before anything is in a language, so the heading is shown in each available one. */}
            <h1 id="bot-language" className="bot-question">
              {LANGUAGES.filter((l) => l.available && isLang(l.code)).map((l) => (
                <span key={l.code} lang={l.bcp47} className="bot-language-title">
                  {uiText(l.code as Lang, 'language.title')}
                </span>
              ))}
            </h1>
            <ul className="bot-language-list">
              {LANGUAGES.map((l) => (
                <li key={l.code}>
                  <button
                    type="button"
                    className={`bot-language-option${l.code === lang ? ' is-current' : ''}`}
                    aria-pressed={l.code === lang}
                    onClick={() => chooseLanguage(l)}
                  >
                    <span className="bot-language-native" lang={l.bcp47}>
                      {l.nativeName}
                    </span>
                    {l.nativeName !== l.englishName && <span className="bot-language-english">{l.englishName}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <p className="bot-language-note" role="status">
              {comingSoon && t('language.comingSoon', { language: comingSoon.nativeName })}
            </p>
          </section>
        )}

        {needsConsent && !needsLanguage && (
          <section className="bot-stage bot-state bot-consent" aria-labelledby="bot-consent">
            <h1 id="bot-consent" className="bot-question">
              {t('consent.title')}
            </h1>
            <p className="bot-state-body">{t('consent.body')}</p>
            <p className="bot-consent-agree">
              {(() => {
                const [before, after = ''] = t('consent.agree').split('{link}');
                return (
                  <>
                    {before}
                    <Link href="/privacy" target="_blank" rel="noopener">
                      {t('consent.privacy')}
                      <span className="sr-only"> {t('consent.newTab')}</span>
                    </Link>
                    {after}
                  </>
                );
              })()}
            </p>
            <div className="bundle-actions">
              <button type="button" className="btn btn-primary" onClick={agree}>
                {t('consent.start')}
                <ArrowIcon />
              </button>
              <button type="button" className="btn btn-outline-dark" onClick={changeLanguage}>
                {t('language.change')}
              </button>
            </div>
          </section>
        )}

        {load.kind === 'error' && (
          <section className="bot-stage bot-state" aria-labelledby="bot-error">
            <h1 id="bot-error" className="bot-closing">
              {load.message}
            </h1>
            <div className="bundle-actions">
              <Link href="/bot?new=1" className="btn btn-primary">
                {t('error.newConversation')}
              </Link>
              <Link href="/dashboard" className="btn btn-outline-dark">
                {t('goDashboard')}
              </Link>
            </div>
          </section>
        )}

        {accepted && (
          <section className="bot-stage bot-state" aria-labelledby="bot-accepted">
            <h1 id="bot-accepted" className="bot-closing">
              {t('accepted.title')}
            </h1>
            <p className="bot-state-body">{t('accepted.body')}</p>
            <div className="bundle-actions">
              <Link href="/dashboard" className="btn btn-primary">
                {t('goDashboard')}
              </Link>
              <Link href="/bot?new=1" className="btn btn-outline-dark">
                {t('accepted.newRequest')}
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
                {t('startOver')}
              </Link>
            ) : (
              <div className="bot-back" aria-hidden="true" />
            )}
            <h1 id="bot-q" className={`bot-question${question.question.length > 80 ? ' is-long' : ''}`}>
              <WordReveal lines={lines} onDone={onRevealed} />
            </h1>

            {chips.shown.length > 0 && (
              <ul className={`bot-suggestions${revealed ? ' is-in' : ''}`} aria-label={t('chips.label')}>
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
                      {t('chips.showAll', { n: chips.hidden + CHIP_LIMIT })}
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
                  intake.bundles ?? [{ tier: 'recommended', label: t('tiers.recommended'), comparison: null, recommendation: intake.recommendation }]
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
              {t('noBundle')}
            </h1>
            <div className="bundle-actions">
              <Link href="/bot?new=1" className="btn btn-primary">
                {t('startOver')}
              </Link>
            </div>
          </section>
        )}
      </main>

      {asking && (
        <div className="bot-dock">
          {voiceOn ? (
            <div className="bot-voice" role="group" aria-label={t('voice.group')}>
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
                  aria-label={t('voice.exit')}
                  title={t('voice.exitTitle')}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="2.5" y="6" width="19" height="12" rx="2" />
                    <path d="M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01M6.5 14.5h11" />
                  </svg>
                </button>
                {voicePause && !pending ? (
                  <button type="button" className="bot-round bot-round-solid" onClick={resumeVoice} aria-label={t('voice.tapToSpeak')}>
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
                      aria-label={t('voice.sendNow')}
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
                  {t('checking')}
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
                  {t('answer.label')}
                </label>
                <input
                  id="bot-input"
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={placeholderFor(question, lang)}
                  autoComplete="off"
                  enterKeyHint="send"
                  inputMode={numeric}
                  maxLength={1000}
                  readOnly={!!pending}
                />
                <button type="button" className="bot-icon-btn" onClick={startVoice} aria-label={t('answer.voice')} disabled={!!pending}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 3a3 3 0 00-3 3v6a3 3 0 006 0V6a3 3 0 00-3-3zM5.5 11a6.5 6.5 0 0013 0M12 17.5V21" />
                  </svg>
                </button>
                <button type="submit" className="bot-send" disabled={!draft.trim() || !!pending} aria-label={t('answer.send')}>
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
    </BotLanguageProvider>
  );
}
