import { describe, expect, it } from 'vitest';
import { ACKNOWLEDGEMENTS, CLOSING_MESSAGE, GREETING } from '@/lib/bot/script';
import { isSpeakable, lineLanguage, speakableLines } from '@/lib/bot/speakable';
import { LANGS } from '@/lib/i18n/languages';
import { localizeQuestion } from '@/lib/i18n/localize';
import { scriptFor } from '@/lib/i18n/ui';
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

  it('covers every question and fixed line in every language, and knows which language each is in', () => {
    for (const lang of LANGS) {
      const script = scriptFor(lang);
      for (const line of [...script.acknowledgements, script.closing, script.greeting, script.welcomeBack]) {
        expect(isSpeakable(line)).toBe(true);
        expect(lineLanguage(line)).toBe(lang);
      }
      for (const q of getQuestions().questions.filter((q) => q.phase !== 'contact')) {
        expect(isSpeakable(localizeQuestion(q, lang).question)).toBe(true);
      }
    }
  });

  it('never whitelists arbitrary text such as LLM replies', () => {
    expect(isSpeakable('Sorry, we couldn’t match that to one of the options.')).toBe(false);
    expect(isSpeakable('माफ़ कीजिए, हम समझ नहीं पाए।')).toBe(false);
    expect(new Set(lines).size).toBe(lines.length);
  });
});
