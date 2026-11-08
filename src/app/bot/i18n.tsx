'use client';

import { createContext, useContext, useMemo } from 'react';
import type { Vars } from '@/lib/i18n/format';
import { DEFAULT_LANG, type Lang } from '@/lib/i18n/languages';
import { quantityText, scriptFor, uiCount, uiText, type UiKey } from '@/lib/i18n/ui';

const BotLanguage = createContext<Lang>(DEFAULT_LANG);

/** The language the conversation runs in, for everything inside the bot. */
export const BotLanguageProvider = BotLanguage.Provider;

/** The bot's copy in the conversation's language. */
export function useBotText() {
  const lang = useContext(BotLanguage);
  return useMemo(
    () => ({
      lang,
      t: (key: UiKey, vars?: Vars) => uiText(lang, key, vars),
      count: (key: 'months' | 'days' | 'addOns.more', n: number) => uiCount(lang, key, n),
      quantity: (n: number, unit: string) => quantityText(lang, n, unit),
      script: scriptFor(lang),
    }),
    [lang],
  );
}

export type BotText = ReturnType<typeof useBotText>;
