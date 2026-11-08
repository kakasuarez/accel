'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/components/api';
import { useBotText } from './i18n';
import type { BundleChoice } from './types';

interface Props {
  leadId: string;
  /** The bundle the customer is looking at. */
  tier: BundleChoice['tier'];
  /** The Recommended explanation if the server already has it; otherwise it is fetched. */
  explanation: string | null;
}

/**
 * The bot's note on why the bundle fits, read as a continuation of its closing line. It follows the bundle
 * the customer picks: each one is written by the LLM once and kept while they compare.
 * Shown, not spoken: it is LLM text with no recorded clip.
 */
export function BotExplanation({ leadId, tier, explanation: initialExplanation }: Props) {
  const [notes, setNotes] = useState<Partial<Record<Props['tier'], string>>>(() => (initialExplanation ? { recommended: initialExplanation } : {}));
  const [failed, setFailed] = useState<Partial<Record<Props['tier'], true>>>({});
  const asked = useRef(new Set<string>());

  useEffect(() => {
    if (notes[tier] || asked.current.has(tier)) return;
    asked.current.add(tier);
    api<{ explanation: string }>(`/api/leads/${encodeURIComponent(leadId)}/explanation?bundle=${tier}`, { method: 'POST' })
      .then((r) => setNotes((prev) => ({ ...prev, [tier]: r.explanation })))
      .catch(() => setFailed((prev) => ({ ...prev, [tier]: true })));
  }, [leadId, tier, notes]);

  const { t } = useBotText();
  const explanation = notes[tier];
  const explaining = !explanation && !failed[tier];
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
          {t(tier === 'recommended' ? 'explain.recommended' : 'explain.other')}
        </p>
      ) : null}
    </section>
  );
}
