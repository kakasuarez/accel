'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useState } from 'react';
import { api, ApiFailure } from '@/components/api';
import { plural, quantityLabel } from '@/components/format';
import { formatRupees } from '@/lib/bot/script';
import type { AddOn, BundleChoice, BundleTotals, CustomerLead, CustomerRecommendation } from './types';

const PHONE = /^\+?[0-9][0-9 ()-]{6,19}$/;
/** Add-ons shown before "Show more": the recommended ones, or at least this many. */
const MIN_VISIBLE_ADD_ONS = 3;

/** Same sum the server does (priceWithAddOns), so the total moves the instant a box is ticked. */
function localTotals(rec: CustomerRecommendation, selected: ReadonlySet<string>): BundleTotals {
  const items = [...rec.lines, ...rec.addOns.filter((a) => selected.has(a.productId))];
  const sum = (pick: (i: (typeof items)[number]) => number) => items.reduce((t, i) => t + pick(i), 0);
  return {
    monthly: sum((i) => i.monthly),
    setupFee: sum((i) => i.setupFee),
    contractMonths: Math.max(0, ...items.map((i) => i.minContractMonths)),
    installDays: Math.max(0, ...items.map((i) => i.installDays)),
  };
}

const RECOMMENDATION_TAG: Record<NonNullable<AddOn['recommendation']>, string> = {
  stated_need: 'You asked for this',
  model: 'Suggested for you',
};

interface Props {
  leadId: string;
  /** Recommended first, then Budget and Premium when they differ from it. */
  bundles: BundleChoice[];
  /** Tells the page which bundle is picked, so the explanation can follow it. */
  onTierChange?: (tier: BundleChoice['tier']) => void;
  /** Called when the server says the quote was already accepted elsewhere. */
  onAlreadyAccepted: () => void;
}

export function BotResult({ leadId, bundles, onTierChange, onAlreadyAccepted }: Props) {
  const router = useRouter();
  const id = useId();
  const base = `/api/leads/${encodeURIComponent(leadId)}`;

  const [tier, setTier] = useState(bundles[0]!.tier);
  const bundle = bundles.find((b) => b.tier === tier) ?? bundles[0]!;
  const rec: CustomerRecommendation = bundle.recommendation;

  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(rec.addOns.filter((a) => a.recommendation !== null).map((a) => a.productId)),
  );
  const [serverTotals, setServerTotals] = useState<{ key: string; totals: BundleTotals } | null>(null);
  const [showAllAddOns, setShowAllAddOns] = useState(false);
  // Ticks are kept across bundles, so looking at another bundle and coming back loses nothing. Only the add-ons
  // the current bundle offers are priced and accepted.
  const offered = useMemo(() => new Set([...selected].filter((productId) => rec.addOns.some((a) => a.productId === productId))), [selected, rec]);
  const selectionKey = useMemo(() => [...offered].sort().join(','), [offered]);
  const priceKey = `${tier}|${selectionKey}`;
  const totals = serverTotals?.key === priceKey ? serverTotals.totals : localTotals(rec, offered);

  // Live price from the server (the source of truth); the local sum covers the gap.
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      const [bundleTier, ids] = priceKey.split('|');
      api<{ totals: BundleTotals }>(`${base}/quote`, { method: 'POST', json: { bundle: bundleTier, selectedAddOns: ids ? ids.split(',') : [] } })
        .then((r) => live && setServerTotals({ key: priceKey, totals: r.totals }))
        .catch(() => {});
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [base, priceKey]);

  const toggle = (productId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });

  const recommendedCount = rec.addOns.filter((a) => a.recommendation !== null).length;
  const visibleCount = Math.max(recommendedCount, MIN_VISIBLE_ADD_ONS);
  const visibleAddOns = showAllAddOns ? rec.addOns : rec.addOns.slice(0, visibleCount);
  const hiddenCount = rec.addOns.length - visibleAddOns.length;
  // A ticked add-on never hides behind "Show more".
  const extraSelected = showAllAddOns ? [] : rec.addOns.slice(visibleCount).filter((a) => selected.has(a.productId));

  // ---- Accept form ----
  const [form, setForm] = useState({ businessName: '', contactName: '', phone: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const validate = () => {
    const e: typeof errors = {};
    if (!form.businessName.trim()) e.businessName = 'Enter your business’s name.';
    if (!form.contactName.trim()) e.contactName = 'Enter the name of the person we should speak to.';
    if (!PHONE.test(form.phone.trim())) e.phone = 'Enter a phone number, like +91 98765 43210.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const accept = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) return;
    setAccepting(true);
    try {
      await api<{ lead: CustomerLead }>(`${base}/accept`, {
        method: 'POST',
        json: {
          bundle: tier,
          selectedAddOns: [...offered],
          businessName: form.businessName.trim(),
          contactName: form.contactName.trim(),
          phone: form.phone.trim(),
        },
      });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setAccepting(false);
      if (err instanceof ApiFailure && err.code === 'already_accepted') return onAlreadyAccepted();
      setSubmitError(err instanceof ApiFailure ? err.message : 'We couldn’t accept the quote. Please try again.');
    }
  };

  const field = (name: keyof typeof form, label: string, props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="field">
      <label htmlFor={`${id}-${name}`}>{label}</label>
      <input
        id={`${id}-${name}`}
        name={name}
        value={form[name]}
        onChange={(ev) => setForm((f) => ({ ...f, [name]: ev.target.value }))}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `${id}-${name}-err` : undefined}
        required
        {...props}
      />
      {errors[name] && (
        <p id={`${id}-${name}-err`} className="field-error">
          {errors[name]}
        </p>
      )}
    </div>
  );

  const addOnRow = (a: AddOn) => (
    <li key={a.productId}>
      <label className={`addon${selected.has(a.productId) ? ' is-on' : ''}`}>
        <input type="checkbox" checked={selected.has(a.productId)} onChange={() => toggle(a.productId)} />
        <span className="addon-box" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <span className="addon-text">
          <span className="addon-name">
            {a.name}
            {a.recommendation && <span className="addon-tag">{RECOMMENDATION_TAG[a.recommendation]}</span>}
          </span>
          <span className="addon-why">{a.why}</span>
        </span>
        <span className="addon-price">
          +{formatRupees(a.monthly)}
          <span>{quantityLabel(a.quantity, a.unit)}</span>
        </span>
      </label>
    </li>
  );

  return (
    <div className="result">
      {bundles.length > 1 && (
        <fieldset className="tiers">
          <legend className="addons-title">Choose your bundle</legend>
          <p className="addons-sub">Monthly prices before add-ons. You can switch any time before you accept.</p>
          <div className="tier-list">
            {bundles.map((b) => (
              <label key={b.tier} className={`tier${b.tier === tier ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name={`${id}-tier`}
                  value={b.tier}
                  checked={b.tier === tier}
                  onChange={() => {
                    setTier(b.tier);
                    onTierChange?.(b.tier);
                  }}
                />
                <span className="tier-head">
                  {b.label}
                  {b.tier === 'recommended' && <span className="addon-tag">Best fit</span>}
                </span>
                <span className="tier-price">
                  <strong>{formatRupees(b.recommendation.totals.monthly)}</strong> a month
                </span>
                <span className="tier-note">{b.comparison ?? 'Our pick for your business, based on your answers.'}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <article className="bundle" aria-labelledby={`${id}-bundle`}>
        <div className="bundle-head">
          <h2 id={`${id}-bundle`} className="bundle-name">
            {bundles.length > 1 ? `${bundle.label} bundle` : 'Your bundle'}
          </h2>
          <span className="chip">{rec.segmentLabel}</span>
        </div>

        <p className="bundle-price" aria-live="polite">
          <strong>{formatRupees(totals.monthly)}</strong>
          <span>a month</span>
        </p>
        <dl className="bundle-facts">
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

        <ul className="bundle-items" aria-label="Included in your bundle">
          {rec.lines.map((line) => (
            <li key={line.productId}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
              <span className="bundle-item-text">
                <strong>
                  {line.name} <span className="bundle-qty">· {quantityLabel(line.quantity, line.unit)}</span>
                </strong>
                <span>{line.why}</span>
              </span>
              <span className="bundle-item-price">{formatRupees(line.monthly)}</span>
            </li>
          ))}
        </ul>

        {rec.flags.length > 0 && (
          <ul className="bundle-flags" aria-label="Good to know">
            {rec.flags.map((flag) => (
              <li key={flag.code}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 11v5.5M12 7.5h.01" />
                </svg>
                <span>{flag.message}</span>
              </li>
            ))}
          </ul>
        )}
      </article>

      {rec.addOns.length > 0 && (
        <fieldset className="addons">
          <legend className="addons-title">Add to your bundle</legend>
          <p className="addons-sub">Optional. Tick anything you’d like and the monthly price updates.</p>
          <ul className="addon-list">
            {visibleAddOns.map(addOnRow)}
            {extraSelected.map(addOnRow)}
          </ul>
          {hiddenCount > 0 && (
            <button type="button" className="text-btn" onClick={() => setShowAllAddOns(true)} aria-expanded={false}>
              Show {plural(hiddenCount - extraSelected.length, 'more add-on')}
            </button>
          )}
        </fieldset>
      )}

      {rec.blocked.length > 0 && (
        <details className="bot-recap">
          <summary>Why some services aren’t included</summary>
          <ul className="blocked-list">
            {rec.blocked.map((b) => (
              <li key={b.productId}>
                <strong>{b.name}</strong>
                <span>{b.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <form className="accept" onSubmit={accept} noValidate aria-labelledby={`${id}-accept`}>
        <h2 id={`${id}-accept`} className="accept-title">
          Accept this quote
        </h2>
        <p className="accept-sub">
          At <strong>{formatRupees(totals.monthly)}</strong> a month. Next, you’ll verify your business
          with a few documents.
        </p>
        {field('businessName', 'Business name', { autoComplete: 'organization', maxLength: 120 })}
        {field('contactName', 'Your name', { autoComplete: 'name', maxLength: 120 })}
        {field('phone', 'Phone number', { type: 'tel', autoComplete: 'tel', inputMode: 'tel', maxLength: 21 })}
        {submitError && (
          <p className="form-alert" role="alert">
            <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5v5.5M12 16.5h.01" />
            </svg>
            <span>{submitError}</span>
          </p>
        )}
        <div className="accept-actions">
          <button type="submit" className="btn btn-primary" disabled={accepting}>
            {accepting ? 'Accepting…' : 'Accept quote'}
          </button>
          <Link href="/bot?new=1" className="btn btn-outline-dark">
            Start over
          </Link>
        </div>
        <p className="bundle-note">Accel is a fictional operator. Prices are synthetic and shown per month.</p>
      </form>
    </div>
  );
}
