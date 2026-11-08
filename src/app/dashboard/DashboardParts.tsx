import Link from 'next/link';
import { formatDateTime, formatDay, formatDayTime, plural, quantityLabel } from '@/components/format';
import { AlertIcon, ArrowIcon, CheckIcon, ClockIcon, InfoIcon, MailIcon, PhoneIcon } from '@/components/icons';
import { formatRupees } from '@/lib/bot/script';
import type { CustomerLead } from '@/lib/dashboard/data';
import type { StepDate, Tracker } from '@/lib/dashboard/tracker';
import { GST_RATE, gstOn, withGst } from '@/lib/gst';
import { SUPPORT_PHONE, SUPPORT_TEL } from '@/lib/support';

/** The grievance officer, who handles consent withdrawals (see /privacy#contact). */
const GRIEVANCE_EMAIL = 'grievance@accelbusiness.example';
const GST_PERCENT = Math.round(GST_RATE * 100);

function StepWhen({ date }: { date: StepDate }) {
  switch (date.kind) {
    case 'done':
      return <time dateTime={date.at}>{formatDay(date.at)}</time>;
    case 'expected':
      return date.overdue ? (
        <span className="is-late">
          Due <time dateTime={date.by}>{formatDay(date.by)}</time> · late
        </span>
      ) : (
        <span>
          By <time dateTime={date.by}>{formatDay(date.by)}</time>
        </span>
      );
    case 'after':
      return <span>Up to {plural(date.days, 'day')}</span>;
  }
}

// The dashboard's sections. Each renders the server's data as given (the tracker is never re-derived here).
export function Stepper({ steps }: { steps: Tracker['steps'] }) {
  const at = steps.findIndex((s) => s.state === 'current');
  return (
    <ol className="stepper" aria-label={at >= 0 ? `Your progress: step ${at + 1} of ${steps.length}` : 'Your progress'}>
      {steps.map((step, i) => (
        <li key={step.key} className={`stepper-step is-${step.state}`} aria-current={step.state === 'current' ? 'step' : undefined}>
          <span className="stepper-mark" aria-hidden="true">
            {step.state === 'done' ? <CheckIcon /> : i + 1}
          </span>
          <span className="stepper-text">
            <span className="stepper-label">
              {step.label}
              <span className="sr-only">{step.state === 'done' ? ' (done)' : step.state === 'current' ? ' (current step)' : ''}</span>
            </span>
            {step.date && (
              <span className="stepper-date">
                <StepWhen date={step.date} />
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What a history event says happened. */
const eventLabel = (event: CustomerLead['history'][number]) =>
  event.status === 'closed' ? 'Request closed' : (event.stage ?? 'Request started');

/** One line under the stepper: how many status updates so far, and the latest. The full list is History. */
export function UpdatesLine({ history }: { history: CustomerLead['history'] }) {
  const latest = history.at(-1);
  if (!latest) return null;
  return (
    <p className="dash-updates">
      <ClockIcon />
      <span>
        {plural(history.length, 'update')} · Latest: {eventLabel(latest)},{' '}
        <time dateTime={latest.at}>{formatDayTime(latest.at)}</time>
        {history.length > 1 && (
          <>
            {' · '}
            <a href="#history">See all</a>
          </>
        )}
      </span>
    </p>
  );
}

export function CurrentStep({ current, escalation }: { current: Tracker['current']; escalation: Tracker['escalation'] }) {
  const waiting = current.kind === 'kyc_review' || current.kind === 'activation';
  const finished = current.kind === 'done';
  // Late: escalating is the thing to do, so it takes the red and the step's own button steps back.
  const late = !!escalation?.overdue;
  const cta = current.cta && (
    <Link href={current.cta.href} className={`btn ${late ? 'btn-outline-dark' : 'btn-primary'} now-cta`}>
      {current.cta.label}
      <ArrowIcon />
    </Link>
  );
  return (
    <section className={`now-card is-${current.kind}`} aria-labelledby="now-title">
      {(waiting || finished) && (
        <span className={`now-status${finished ? ' is-done' : ''}`} aria-hidden="true">
          {finished ? <CheckIcon /> : <ClockIcon />}
        </span>
      )}
      <h2 id="now-title" className="now-title">
        {current.title}
      </h2>
      <p className="now-body">{current.body}</p>

      {current.reasons && current.reasons.length > 0 && (
        <ul className="reason-list" aria-label="What to fix">
          {current.reasons.map((reason) => (
            <li key={reason}>
              <AlertIcon />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}

      {late ? (
        <div className="now-actions">
          <a href={SUPPORT_TEL} className="btn btn-primary now-cta">
            <PhoneIcon />
            Escalate: call {SUPPORT_PHONE}
          </a>
          {cta}
        </div>
      ) : (
        cta
      )}
      {current.kind === 'start' && <p className="now-note">Takes about two minutes. Answer by typing, tapping or speaking.</p>}
      {escalation && !late && (
        <div className="now-escalate">
          <span>Something not right?</span>
          <a href={SUPPORT_TEL} className="btn btn-outline-dark btn-sm">
            <PhoneIcon />
            Call {SUPPORT_PHONE} to escalate
          </a>
        </div>
      )}
      {late && <p className="now-note">Our support line is open 24×7.</p>}
    </section>
  );
}

const BUNDLE_LABELS: Record<NonNullable<CustomerLead['quote']>['bundle'], string> = {
  recommended: 'Recommended',
  budget: 'Budget',
  premium: 'Premium',
};

export function BundleSummary({ quote }: { quote: NonNullable<CustomerLead['quote']> }) {
  const { lines, addOns, totals, flags } = quote;
  return (
    <section className="dash-section" aria-labelledby="bundle-title">
      <div className="dash-section-head">
        <h2 id="bundle-title" className="dash-h2">
          Your bundle
        </h2>
        <span className="chip">{BUNDLE_LABELS[quote.bundle]} · Accepted</span>
      </div>

      <div className="summary">
        <div className="summary-head">
          <p className="summary-price">
            <strong>{formatRupees(totals.monthly)}</strong>
            <span>a month + GST</span>
          </p>
          <dl className="tax-lines">
            <div>
              <dt>GST at {GST_PERCENT}%</dt>
              <dd>+{formatRupees(gstOn(totals.monthly))} a month</dd>
            </div>
            <div className="is-total">
              <dt>You pay, with GST</dt>
              <dd>{formatRupees(withGst(totals.monthly))} a month</dd>
            </div>
            {totals.setupFee > 0 && (
              <div className="is-once">
                <dt>GST on the setup fee at {GST_PERCENT}%</dt>
                <dd>+{formatRupees(gstOn(totals.setupFee))} once</dd>
              </div>
            )}
          </dl>
        </div>
        <dl className="summary-facts">
          <div>
            <dt>One-time setup</dt>
            <dd>{totals.setupFee > 0 ? formatRupees(totals.setupFee) : 'None'}</dd>
          </div>
          <div>
            <dt>Minimum contract</dt>
            <dd>{plural(totals.contractMonths, 'month')}</dd>
          </div>
          <div>
            <dt>Installation</dt>
            <dd>Up to {plural(totals.installDays, 'day')}</dd>
          </div>
        </dl>

        <ul className="item-list" aria-label="Included">
          {lines.map((line) => (
            <li key={line.productId}>
              <span className="item-main">
                <strong>{line.name}</strong>
                <span>{quantityLabel(line.quantity, line.unit)}</span>
              </span>
              <span className="item-price">{formatRupees(line.monthly)}</span>
            </li>
          ))}
          {addOns.map((addOn) => (
            <li key={addOn.productId}>
              <span className="item-main">
                <strong>{addOn.name}</strong>
                <span>Add-on · {quantityLabel(addOn.quantity, addOn.unit)}</span>
              </span>
              <span className="item-price">{formatRupees(addOn.monthly)}</span>
            </li>
          ))}
        </ul>

        {flags.length > 0 && (
          <ul className="note-list" aria-label="Good to know">
            {flags.map((flag) => (
              <li key={flag.code}>
                <InfoIcon />
                <span>{flag.message}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="fine-print">Prices exclude GST unless shown with it. Accel is a fictional operator and all prices are synthetic.</p>
      </div>
    </section>
  );
}

export function History({ history }: { history: CustomerLead['history'] }) {
  const items = [...history].reverse();
  return (
    <section id="history" className="dash-section" aria-labelledby="history-title">
      <h2 id="history-title" className="dash-h2">
        History
      </h2>
      <ol className="history">
        {items.map((event, i) => (
          <li key={`${event.at}-${i}`}>
            <span className="history-what">{eventLabel(event)}</span>
            <time dateTime={event.at}>{formatDateTime(event.at)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A ready-to-send email to the grievance officer, so withdrawing is one tap. */
function withdrawHref(leadId: string, email: string) {
  const body = [
    'Hello,',
    '',
    'I withdraw my consent for my Accel Business request. Please stop work on it and erase its data.',
    '',
    `Request reference: ${leadId}`,
    `Account email: ${email}`,
    '',
    'Thank you.',
  ].join('\r\n');
  return `mailto:${GRIEVANCE_EMAIL}?subject=${encodeURIComponent('Withdraw my consent')}&body=${encodeURIComponent(body)}`;
}

export function ConsentSection({ leadId, email, checkedDocuments }: { leadId: string; email: string; checkedDocuments: boolean }) {
  return (
    <section id="consent" className="dash-section" aria-labelledby="consent-title">
      <h2 id="consent-title" className="dash-h2">
        Your consent
      </h2>
      <p className="consent-intro">You agreed to:</p>
      <ul className="consent-list">
        <li>
          <CheckIcon />
          <span>Accel Bot’s questions, and using your answers to prepare your quote</span>
        </li>
        {checkedDocuments && (
          <li>
            <CheckIcon />
            <span>Checking your business documents to verify your business</span>
          </li>
        )}
      </ul>
      <div className="consent-withdraw">
        <a href={withdrawHref(leadId, email)} className="btn btn-outline-dark btn-sm">
          <MailIcon />
          Withdraw consent
        </a>
        <p>
          Opens a ready-to-send email to our grievance officer. We’ll stop work on this request and erase its data.{' '}
          <Link href="/privacy#consent">How consent works</Link>
        </p>
      </div>
    </section>
  );
}
