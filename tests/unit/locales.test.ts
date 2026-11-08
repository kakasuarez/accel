import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lookup, placeholders, type LocaleFile } from '@/lib/i18n/format';
import { LANGUAGES, LANGS, TRANSLATED_LANGS } from '@/lib/i18n/languages';
import { contentSource, uiSource } from '@/lib/i18n/source';
import { quantityText, scriptFor, uiText } from '@/lib/i18n/ui';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (kind: string, lang: string) => JSON.parse(readFileSync(resolve(ROOT, 'data/locales', kind, `${lang}.json`), 'utf8')) as LocaleFile;
const KINDS = { content: contentSource(), ui: uiSource() };

describe('translations', () => {
  for (const [kind, source] of Object.entries(KINDS)) {
    for (const lang of TRANSLATED_LANGS) {
      const file = read(kind, lang);

      it(`${kind}/${lang} translates every string from the current English (run npm run translate)`, () => {
        const missing = Object.keys(source).filter((key) => !file[key]?.text);
        const stale = Object.keys(source).filter((key) => file[key] && file[key].en !== source[key]);
        expect({ missing, stale }).toEqual({ missing: [], stale: [] });
      });

      it(`${kind}/${lang} keeps every placeholder`, () => {
        const broken = Object.entries(file).filter(([, entry]) => placeholders(entry.en).join() !== placeholders(entry.text).join());
        expect(broken.map(([key]) => key)).toEqual([]);
      });

      it(`${kind}/${lang} holds nothing that isn't in the source`, () => {
        expect(Object.keys(file).filter((key) => !(key in source))).toEqual([]);
      });
    }
  }

  it('never uses a translation made from older English', () => {
    const file: LocaleFile = { k: { en: 'Old text', text: 'पुराना' } };
    expect(lookup(file, 'k', 'Old text')).toBe('पुराना');
    expect(lookup(file, 'k', 'New text')).toBe('New text');
    expect(lookup(file, 'missing', 'English')).toBe('English');
  });

  it('runs the bot in English, Hindi and Tamil, and lists the rest as coming', () => {
    expect([...LANGS]).toEqual(['en', 'hi', 'ta']);
    expect(LANGUAGES.filter((l) => l.available).map((l) => l.code)).toEqual([...LANGS]);
    expect(LANGUAGES.filter((l) => !l.available).map((l) => l.code)).toEqual(['bn', 'mr', 'te', 'kn']);
  });

  it('gives each language its own script and screen copy', () => {
    const en = scriptFor('en');
    for (const lang of TRANSLATED_LANGS) {
      const script = scriptFor(lang);
      expect(script.greeting).not.toBe(en.greeting);
      expect(new Set(script.acknowledgements).size).toBe(en.acknowledgements.length);
      expect(uiText(lang, 'consent.agree')).toContain('{link}');
      expect(uiText(lang, 'accept.sub')).toContain('{price}');
      expect(quantityText(lang, 3, 'per site')).toContain('3');
    }
    expect(quantityText('en', 3, 'per site')).toBe('3 sites');
  });
});
