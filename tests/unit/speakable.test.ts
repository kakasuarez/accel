import { describe, expect, it } from 'vitest';
import { ACKNOWLEDGEMENTS, CLOSING_MESSAGE, GREETING } from '@/lib/bot/script';
import { isSpeakable, speakableLines } from '@/lib/bot/speakable';
import { getQuestions } from '@/lib/questions';

describe('bot voice lines', () => {
  const lines = speakableLines();

  it('covers every question the backend can ask aloud', () => {
    for (const q of getQuestions().questions) {
      if (q.phase === 'contact') expect(lines).not.toContain(q.question);
      else expect(lines).toContain(q.question);
    }
  });

  it('covers the fixed lines', () => {
    for (const line of [...ACKNOWLEDGEMENTS, CLOSING_MESSAGE, GREETING]) expect(isSpeakable(line)).toBe(true);
  });

  it('never whitelists arbitrary text such as LLM replies', () => {
    expect(isSpeakable('Sorry, we couldn’t match that to one of the options.')).toBe(false);
    expect(new Set(lines).size).toBe(lines.length);
  });
});
