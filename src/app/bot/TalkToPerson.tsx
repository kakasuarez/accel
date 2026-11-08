'use client';

import { PhoneIcon } from '@/components/icons';
import { SUPPORT_PHONE, SUPPORT_TEL } from '@/lib/support';
import { useBotText } from './i18n';

/** "Talk to a person": a call to the support line, on the quote screen and when no bundle could be built. */
export function TalkToPerson({ lead }: { lead?: string }) {
  const { t } = useBotText();
  return (
    <p className="bot-talk">
      {lead && <span className="bot-talk-lead">{lead}</span>}
      <a href={SUPPORT_TEL} className="bot-talk-link">
        <PhoneIcon className="bot-talk-icon" />
        <span>
          <span className="bot-talk-label">{t('talk.label')}</span>
          <span className="bot-talk-number">
            <span aria-hidden="true"> · </span>
            {t('talk.call', { phone: SUPPORT_PHONE })}
          </span>
        </span>
      </a>
    </p>
  );
}
