// Shared by the server and the bot UI. Client-safe.

/** One translated string, with the English it was translated from. A changed English source makes it stale. */
export interface LocaleEntry {
  en: string;
  text: string;
}
export type LocaleFile = Readonly<Record<string, LocaleEntry>>;

export type Vars = Readonly<Record<string, string | number>>;

/** Fills `{name}` placeholders. Unknown placeholders are left as they are. */
export function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/**
 * The translation of `english` under `key`, or the English itself when there is none or it was made from older
 * English. A stale translation could say something the English no longer does, so it is never used.
 */
export function lookup(file: LocaleFile | undefined, key: string, english: string): string {
  const entry = file?.[key];
  return entry && entry.en === english && entry.text ? entry.text : english;
}

/** The `{placeholders}` in a template, sorted, for checking that a translation kept them all. */
export const placeholders = (template: string) => [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
