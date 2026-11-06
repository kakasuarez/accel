'use client';

import { useEffect, useMemo } from 'react';

export interface RevealLine {
  text: string;
  className?: string;
}

interface Props {
  lines: RevealLine[];
  /** Delay before the first word, ms. */
  delay?: number;
  /** Time between words, ms. */
  stagger?: number;
  /** Extra pause between lines, ms (acknowledgement → question). */
  linePause?: number;
  onDone?: () => void;
}

const WORD_MS = 620;

/** Reveals text word by word. Screen readers get each line whole. */
export function WordReveal({ lines, delay = 80, stagger = 55, linePause = 260, onDone }: Props) {
  const { rendered, total } = useMemo(() => {
    let at = delay;
    const out = lines.map((line, li) => {
      if (li > 0) at += linePause;
      const words = line.text.split(/\s+/).filter(Boolean).map((word) => {
        const w = { word, at };
        at += stagger;
        return w;
      });
      return { ...line, words };
    });
    return { rendered: out, total: at - stagger + WORD_MS };
  }, [lines, delay, stagger, linePause]);

  useEffect(() => {
    if (!onDone) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = window.setTimeout(onDone, reduced ? 0 : total);
    return () => window.clearTimeout(id);
    // Run once per text; onDone identity changes must not restart the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, lines]);

  return (
    <>
      {rendered.map((line, li) => (
        <span key={li} className={line.className ? `reveal-line ${line.className}` : 'reveal-line'}>
          <span className="sr-only">{line.text}</span>
          <span aria-hidden="true">
            {line.words.map((w, wi) => (
              <span key={wi}>
                <span className="reveal-word" style={{ animationDelay: `${w.at}ms` }}>
                  {w.word}
                </span>
                {wi < line.words.length - 1 ? ' ' : null}
              </span>
            ))}
          </span>
        </span>
      ))}
    </>
  );
}
