import Link from 'next/link';
import { formatDateTime, plural, quantityLabel } from '@/components/format';
import { AlertIcon, ArrowIcon, CheckIcon, ClockIcon, InfoIcon } from '@/components/icons';
import { formatRupees } from '@/lib/bot/script';
import type { CustomerLead } from '@/lib/dashboard/data';
import type { Tracker } from '@/lib/dashboard/tracker';

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
          <span className="stepper-label">
            {step.label}
            <span className="sr-only">{step.state === 'done' ? ' (done)' : step.state === 'current' ? ' (current step)' : ''}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function CurrentStep({ current }: { current: Tracker['current'] }) {
  const waiting = current.kind === 'kyc_review' || current.kind === 'activation';
  const finished = current.kind === 'done';
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

      {current.cta && (
        <Link href={current.cta.href} className="btn btn-primary now-cta">
          {current.cta.label}
          <ArrowIcon />
        </Link>
      )}
      {current.kind === 'start' && <p className="now-note">Takes about two minutes. Answer by typing, tapping or speaking.</p>}
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
        <p className="summary-price">
          <strong>{formatRupees(totals.monthly)}</strong>
          <span>a month</span>
        </p>
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
        <p className="fine-print">Accel is a fictional operator and all prices are synthetic.</p>
      </div>
    </section>
  );
}

export function History({ history }: { history: CustomerLead['history'] }) {
  const items = [...history].reverse();
  return (
    <section className="dash-section" aria-labelledby="history-title">
      <h2 id="history-title" className="dash-h2">
        History
      </h2>
      <ol className="history">
        {items.map((event, i) => (
          <li key={`${event.at}-${i}`}>
            <span className="history-what">{event.status === 'closed' ? 'Request closed' : (event.stage ?? 'Request started')}</span>
            <time dateTime={event.at}>{formatDateTime(event.at)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
