'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/components/api';

interface Props {
  leadId: string;
  /** The explanation if the server already has it; otherwise it is fetched once. */
  explanation: string | null;
}

/**
 * The bot's note on why the bundle fits, read as a continuation of its closing line.
 * Shown, not spoken: it is LLM text with no recorded clip.
 */
export function BotExplanation({ leadId, explanation: initialExplanation }: Props) {
  // The explanation is written by the LLM once per set of answers; fetch it if it isn't ready yet.
  const [explanation, setExplanation] = useState(initialExplanation);
  const [explaining, setExplaining] = useState(!initialExplanation);
  const asked = useRef(false);
  useEffect(() => {
    if (initialExplanation || asked.current) return;
    asked.current = true;
    api<{ explanation: string }>(`/api/leads/${encodeURIComponent(leadId)}/explanation`, { method: 'POST' })
      .then((r) => setExplanation(r.explanation))
      .catch(() => {})
      .finally(() => setExplaining(false));
  }, [leadId, initialExplanation]);

  return (
    <section className="explain" aria-live="polite" aria-busy={explaining}>
      {explanation ? (
        <p className="explain-text">{explanation}</p>
      ) : explaining ? (
        <p className="explain-pending">
          <span className="bot-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          Writing a short note on why this fits your business
        </p>
      ) : null}
    </section>
  );
}
