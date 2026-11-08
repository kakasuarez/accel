-- The language the customer chose for Accel Bot. Answers are still stored as English values; only what the
-- customer sees is translated. Keep the list in step with LANGS in src/lib/i18n/languages.ts.
alter table public.leads
  add column language text not null default 'en' check (language in ('en', 'hi', 'ta'));
