'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { api, ApiFailure } from '@/components/api';
import { AlertIcon, ArrowIcon, CheckIcon, ClockIcon, InfoIcon, ShieldIcon, UploadIcon } from '@/components/icons';
import type { KycCheck } from '@/lib/kyc/store';
import type { DocType } from '@/lib/kyc/types';

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ACCEPT = 'image/png,image/jpeg,image/webp';

const DOC_LABEL: Record<DocType, string> = {
  gst_certificate: 'GST certificate',
  udyam_certificate: 'Udyam certificate',
  signatory_id: 'Signatory ID',
  address_proof: 'Address proof',
};

/**
 * The engine's stages, in order. Reading (OCR) is nearly all of the wait; the registry and matching checks
 * run in milliseconds once it finishes, so they are ticked off when the answer arrives, at a pace people can follow.
 */
const PROGRESS = ['Reading your documents', 'Checking the GST and Udyam registries', 'Matching names, addresses and dates'];
const STEP_MS = 650;

const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

type Files = Partial<Record<DocType, File>>;
type Phase = { kind: 'form' } | { kind: 'checking' } | { kind: 'approved' } | { kind: 'review' };

interface Props {
  leadId: string;
  hasGstin: boolean | undefined;
  previous: KycCheck | null;
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function KycForm({ leadId, hasGstin, previous }: Props) {
  const [files, setFiles] = useState<Files>({});
  const [slotErrors, setSlotErrors] = useState<Partial<Record<DocType, string>>>({});
  const [phase, setPhase] = useState<Phase>({ kind: previous?.decision === 'MANUAL_REVIEW' ? 'review' : 'form' });
  const [step, setStep] = useState(0);
  const [rejected, setRejected] = useState<KycCheck | null>(previous?.decision === 'REJECT' ? previous : null);
  /** The attempt waiting for manual review, if any. The customer may replace it with a new upload. */
  const [review, setReview] = useState<KycCheck | null>(previous?.decision === 'MANUAL_REVIEW' ? previous : null);
  const [shownFresh, setShownFresh] = useState(false);
  const [error, setError] = useState<{ message: string; toDashboard?: boolean } | null>(null);
  /**
   * Consent to the document check, given on the consent step. It lasts for this page visit, so a re-upload after a
   * rejection or from the review screen doesn't ask again; a fresh page load starts unticked.
   */
  const [agreed, setAgreed] = useState(false);
  const [ticked, setTicked] = useState(false);
  const [consentError, setConsentError] = useState(false);
  /** Bumped to move focus: to the consent checkbox (`consent`) or to the first upload slot (`form`). */
  const [focusTo, setFocusTo] = useState<{ target: 'consent' | 'form'; n: number } | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // A customer who said they are GST-registered must upload the GST certificate; the server enforces the same.
  const gstRequired = hasGstin === true;
  const hasRegistration = gstRequired ? !!files.gst_certificate : !!(files.gst_certificate || files.udyam_certificate);
  const ready = hasRegistration && !!files.signatory_id && !!files.address_proof;

  const missing = [
    !hasRegistration && (gstRequired ? 'the GST certificate' : 'a GST or Udyam certificate'),
    !files.signatory_id && 'the signatory ID',
    !files.address_proof && 'an address proof',
  ].filter(Boolean) as string[];

  const pick = (slot: DocType, file: File | null) => {
    setError(null);
    if (!file) {
      setFiles(({ [slot]: _drop, ...rest }) => rest);
      setSlotErrors(({ [slot]: _drop, ...rest }) => rest);
      return;
    }
    let problem: string | null = null;
    if (!TYPES.has(file.type)) problem = 'This file isn’t a PNG, JPEG or WebP image. Take a photo or export a scan as an image.';
    else if (file.size > MAX_BYTES) problem = `This image is ${formatSize(file.size)}. Use one under 5 MB.`;
    else if (file.size === 0) problem = 'This file is empty. Choose another image.';
    if (problem) {
      setSlotErrors((prev) => ({ ...prev, [slot]: problem }));
      setFiles(({ [slot]: _drop, ...rest }) => rest);
      return;
    }
    setSlotErrors(({ [slot]: _drop, ...rest }) => rest);
    setFiles((prev) => ({ ...prev, [slot]: file }));
  };

  const proceed = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticked) {
      setConsentError(true);
      setFocusTo((f) => ({ target: 'consent', n: (f?.n ?? 0) + 1 }));
      return;
    }
    setError(null);
    setAgreed(true);
    setFocusTo((f) => ({ target: 'form', n: (f?.n ?? 0) + 1 }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !agreed) return;
    setError(null);
    setStep(0);
    setPhase({ kind: 'checking' });
    const form = new FormData();
    (Object.keys(files) as DocType[]).forEach((slot) => {
      const file = files[slot];
      if (file) form.append(slot, file, file.name);
    });
    // The customer ticked the consent box to get here; the server refuses uploads without it.
    form.append('consent', 'yes');
    try {
      const check = await api<KycCheck>(`/api/leads/${encodeURIComponent(leadId)}/kyc`, { method: 'POST', body: form });
      // Reading is done; tick off the remaining stages before showing the outcome.
      for (let i = 1; i <= PROGRESS.length; i++) {
        setStep(i);
        await pause(STEP_MS);
      }
      // No router.refresh() here: this page sends the customer to the dashboard once KYC is approved, and a
      // refresh would replace the outcome before they could read it. The dashboard is dynamic, so it is fresh.
      setShownFresh(true);
      if (check.decision === 'APPROVE') setPhase({ kind: 'approved' });
      else if (check.decision === 'MANUAL_REVIEW') {
        setRejected(null);
        setReview(check);
        setPhase({ kind: 'review' });
      } else {
        setRejected(check);
        setReview(null);
        setPhase({ kind: 'form' });
      }
    } catch (err) {
      const failure = err instanceof ApiFailure ? err : null;
      if (failure?.code === 'verified') {
        setPhase({ kind: 'approved' });
        return;
      }
      setPhase({ kind: 'form' });
      if (failure?.code === 'consent_required') {
        // Back to the consent step; the chosen files are kept for when they agree.
        setAgreed(false);
        setTicked(false);
        setError({ message: failure.message });
        setFocusTo((f) => ({ target: 'consent', n: (f?.n ?? 0) + 1 }));
        return;
      }
      setError({
        message: failure?.message ?? 'Something went wrong while checking your documents. Please try again.',
        toDashboard: failure?.code === 'not_ready' || failure?.code === 'closed',
      });
    }
  };

  // Move focus to a fresh outcome so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (shownFresh) resultRef.current?.focus();
  }, [phase.kind, rejected, shownFresh]);

  // After the consent step: land on the first upload slot, or back on the checkbox when it still needs ticking.
  useEffect(() => {
    if (!focusTo) return;
    if (focusTo.target === 'consent') consentRef.current?.focus();
    else formRef.current?.querySelector<HTMLInputElement>('input[type="file"]')?.focus();
  }, [focusTo]);

  if (phase.kind === 'checking') return <Checking step={step} />;

  if (phase.kind === 'approved') {
    return (
      <div className="kyc-result is-approved" ref={resultRef} tabIndex={-1} role="status">
        <span className="kyc-result-mark" aria-hidden="true">
          <CheckIcon />
        </span>
        <h2 className="kyc-result-title">Your business is verified</h2>
        <p>Thank you. Our team will contact you to schedule installation.</p>
        <Link href="/dashboard" className="btn btn-primary">
          Back to dashboard
          <ArrowIcon />
        </Link>
      </div>
    );
  }

  if (phase.kind === 'review') {
    const notes = review?.findings.filter((f) => f.severity === 'REVIEW') ?? [];
    return (
      <div className="kyc-result is-review" ref={resultRef} tabIndex={-1} role="status">
        <span className="kyc-result-mark" aria-hidden="true">
          <ClockIcon />
        </span>
        <h2 className="kyc-result-title">Your documents are under review</h2>
        <p>
          A few details need a person to check them. We’ll update your dashboard when it’s done. You don’t need to do
          anything, but if a clearer photo or a different document would answer the points below, you can upload it now.
        </p>
        {notes.length > 0 && (
          <ul className="note-list" aria-label="What we’re checking">
            {notes.map((f, i) => (
              <li key={`${f.code}-${i}`}>
                <ClockIcon />
                <span>
                  {f.doc && <strong>{DOC_LABEL[f.doc as DocType] ?? f.doc}: </strong>}
                  {f.message}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="kyc-result-actions">
          <Link href="/dashboard" className="btn btn-primary">
            Back to dashboard
            <ArrowIcon />
          </Link>
          <button
            type="button"
            className="btn btn-outline-dark"
            onClick={() => {
              setShownFresh(false);
              setPhase({ kind: 'form' });
            }}
          >
            Upload new documents
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {rejected && <Rejected check={rejected} fresh={shownFresh} innerRef={resultRef} />}
      {review && !rejected && (
        <p className="kyc-hint">
          <InfoIcon /> Your current documents stay under review unless you upload new ones. A new upload is checked from
          the start and replaces them.
        </p>
      )}

      <DigiLocker />

      {!agreed ? (
        <form className="kyc-consent" onSubmit={proceed} noValidate aria-labelledby="kyc-consent-title">
          <h2 id="kyc-consent-title">Before you upload</h2>
          <dl className="kyc-consent-facts">
            <div>
              <dt>What we check</dt>
              <dd>
                Your GST certificate, Udyam certificate, a photo ID of the person who signs for the business, and an address
                proof.
              </dd>
            </div>
            <div>
              <dt>Why</dt>
              <dd>To verify your business against the GST and Udyam registries before we install your connection.</dd>
            </div>
            <div>
              <dt>How</dt>
              <dd>
                We read your documents in memory with OCR on our own server. The images and the text read from them are never
                stored. We keep only the decision (approved, under review or rejected) and the reasons for it, with ID numbers
                masked.
              </dd>
            </div>
          </dl>
          <p className="kyc-consent-more">
            Read more, including how to withdraw your consent, in our{' '}
            <Link href="/privacy" target="_blank" rel="noopener">
              Privacy Policy<span className="sr-only"> (opens in a new tab)</span>
            </Link>
            .
          </p>

          <div className={`kyc-agree${consentError ? ' has-error' : ''}`}>
            <input
              ref={consentRef}
              id="kyc-consent"
              type="checkbox"
              checked={ticked}
              onChange={(e) => {
                setTicked(e.target.checked);
                if (e.target.checked) setConsentError(false);
              }}
              aria-invalid={consentError}
              aria-describedby={consentError ? 'kyc-consent-err' : undefined}
            />
            <label htmlFor="kyc-consent">
              I agree to Accel Business checking these documents for business verification, as described above and in the
              Privacy Policy.
            </label>
          </div>
          {consentError && (
            <p id="kyc-consent-err" className="field-error" role="alert">
              Tick the box to continue. We can’t check your documents without your agreement.
            </p>
          )}

          {error && (
            <div className="form-alert" role="alert">
              <AlertIcon />
              <span>{error.message}</span>
            </div>
          )}

          <div className="kyc-submit">
            <button type="submit" className="btn btn-primary">
              Continue
              <ArrowIcon />
            </button>
            {review && !rejected && (
              <button type="button" className="btn btn-outline-dark" onClick={() => setPhase({ kind: 'review' })}>
                Keep the current review
              </button>
            )}
          </div>
        </form>
      ) : (
        <form ref={formRef} className="kyc-form" onSubmit={submit} noValidate aria-describedby="kyc-privacy">
          <fieldset className="kyc-group">
            <legend>
              Business registration{' '}
              <span className="kyc-need">{gstRequired ? 'GST required, Udyam optional' : 'GST or Udyam, at least one'}</span>
            </legend>
            {gstRequired && (
              <p className="kyc-hint">
                <InfoIcon /> You told us your business is registered for GST, so we need your GST certificate.
              </p>
            )}
            {hasGstin === false && (
              <p className="kyc-hint">
                <InfoIcon /> Not registered for GST? Upload your Udyam certificate.
              </p>
            )}
            <Slot
              slot="gst_certificate"
              label="GST certificate"
              hint={gstRequired ? 'The certificate for your GSTIN, form REG-06.' : 'Or upload your Udyam certificate below.'}
              required={gstRequired}
              file={files.gst_certificate}
              error={slotErrors.gst_certificate}
              onPick={pick}
            />
            <Slot
              slot="udyam_certificate"
              label="Udyam certificate"
              hint={gstRequired ? 'Optional. Add it if you have one.' : 'Or upload your GST certificate above.'}
              file={files.udyam_certificate}
              error={slotErrors.udyam_certificate}
              onPick={pick}
            />
          </fieldset>

          <fieldset className="kyc-group">
            <legend>
              Signatory and address <span className="kyc-need">Both required</span>
            </legend>
            <Slot
              slot="signatory_id"
              label="Signatory ID"
              hint="Photo ID of the person authorised to sign for the business."
              required
              file={files.signatory_id}
              error={slotErrors.signatory_id}
              onPick={pick}
            />
            <Slot
              slot="address_proof"
              label="Address proof"
              hint="A bill for the business address, dated within the last 90 days."
              required
              file={files.address_proof}
              error={slotErrors.address_proof}
              onPick={pick}
            />
          </fieldset>

          <p id="kyc-privacy" className="kyc-privacy">
            <ShieldIcon />
            <span>
              As you agreed, your documents are read in memory and never stored. We keep only the decision and the reasons for
              it.{' '}
              <Link href="/privacy" target="_blank" rel="noopener">
                Privacy Policy<span className="sr-only"> (opens in a new tab)</span>
              </Link>
            </span>
          </p>

          {error && (
            <div className="form-alert" role="alert">
              <AlertIcon />
              <span>
                {error.message}
                {error.toDashboard && (
                  <>
                    {' '}
                    <Link href="/dashboard">Go to your dashboard</Link>
                  </>
                )}
              </span>
            </div>
          )}

          <div className="kyc-submit">
            <button type="submit" className="btn btn-primary" disabled={!ready}>
              {rejected ? 'Check my documents again' : 'Check my documents'}
            </button>
            <p className="kyc-missing" aria-live="polite">
              {ready ? 'Ready. The check can take up to a minute.' : `Still needed: ${missing.join(', ')}.`}
            </p>
            {review && !rejected && (
              <button type="button" className="btn btn-outline-dark" onClick={() => setPhase({ kind: 'review' })}>
                Keep the current review
              </button>
            )}
          </div>
        </form>
      )}
    </>
  );
}

/**
 * Verifying through DigiLocker isn't connected yet. The option is shown so owners know it's on the way; choosing it
 * says so and points them to the upload, which works today.
 */
function DigiLocker() {
  const [asked, setAsked] = useState(false);
  return (
    <div className="kyc-digilocker">
      <button type="button" className="dl-option" onClick={() => setAsked(true)} aria-describedby="kyc-dl-note">
        <span className="dl-mark" aria-hidden="true">
          {/* DigiLocker's own symbol, from its official logo. The label names the service, so the mark is decorative. */}
          <img src="/brands/digilocker-mark.svg" alt="" width={30} height={28} />
        </span>
        <span className="dl-text">
          <span className="dl-label">Verify with DigiLocker</span>
          <span className="dl-hint">Share your documents from your DigiLocker account, with no photos to take.</span>
        </span>
        <span className="dl-action" aria-hidden="true">
          Connect
        </span>
      </button>
      {/* Always in the page, so screen readers announce the note when it appears. */}
      <div id="kyc-dl-note" role="status">
        {asked && (
          <p className="kyc-hint dl-soon">
            <ClockIcon /> DigiLocker verification is coming soon. For now, upload your documents below.
          </p>
        )}
      </div>
      <p className="kyc-or">
        <span>Or upload your documents</span>
      </p>
    </div>
  );
}

function Rejected({ check, fresh, innerRef }: { check: KycCheck; fresh: boolean; innerRef: React.Ref<HTMLDivElement> }) {
  const blocking = check.findings.filter((f) => f.severity === 'REJECT');
  const secondary = check.findings.filter((f) => f.severity === 'REVIEW');
  const label = (doc?: string) => (doc ? (DOC_LABEL[doc as DocType] ?? doc) : null);
  return (
    <div className="kyc-rejected" ref={innerRef} tabIndex={-1} role={fresh ? 'alert' : undefined}>
      <h2 className="kyc-rejected-title">
        <AlertIcon />
        {fresh ? 'We couldn’t verify your business' : 'Your last upload couldn’t be verified'}
      </h2>
      <p>Fix the points below, then upload your documents again.</p>
      {blocking.length > 0 && (
        <ul className="reason-list">
          {blocking.map((f, i) => (
            <li key={`${f.code}-${i}`}>
              <AlertIcon />
              <span>
                {label(f.doc) && <strong>{label(f.doc)}: </strong>}
                {f.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {secondary.length > 0 && (
        <>
          <h3 className="kyc-also">Also worth checking</h3>
          <ul className="note-list">
            {secondary.map((f, i) => (
              <li key={`${f.code}-${i}`}>
                <ClockIcon />
                <span>
                  {label(f.doc) && <strong>{label(f.doc)}: </strong>}
                  {f.message}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

interface SlotProps {
  slot: DocType;
  label: string;
  hint: string;
  required?: boolean;
  file: File | undefined;
  error: string | undefined;
  onPick: (slot: DocType, file: File | null) => void;
}

function Slot({ slot, label, hint, required, file, error, onPick }: SlotProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Keep the native input in step when the file is cleared, so choosing the same file again still fires.
  useEffect(() => {
    if (!file && inputRef.current) inputRef.current.value = '';
  }, [file]);

  const describedBy = [`${id}-hint`, error ? `${id}-err` : ''].filter(Boolean).join(' ');

  return (
    <div className={`slot${file ? ' has-file' : ''}${error ? ' has-error' : ''}${dragging ? ' is-drag' : ''}`}>
      <input
        ref={inputRef}
        id={id}
        className="slot-input"
        type="file"
        accept={ACCEPT}
        name={slot}
        aria-describedby={describedBy}
        aria-invalid={!!error}
        onChange={(e) => onPick(slot, e.target.files?.[0] ?? null)}
      />
      <label
        htmlFor={id}
        className="slot-target"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) onPick(slot, dropped);
        }}
      >
        <span className="slot-thumb" aria-hidden="true">
          {preview ? <img src={preview} alt="" /> : <UploadIcon />}
        </span>
        <span className="slot-text">
          <span className="slot-label">
            {label}
            {required && <span className="slot-req"> (required)</span>}
          </span>
          {file ? (
            <span className="slot-file">
              {file.name} · {formatSize(file.size)}
            </span>
          ) : (
            <span id={`${id}-hint`} className="slot-hint">
              {hint}
            </span>
          )}
        </span>
        <span className="slot-action" aria-hidden="true">
          {file ? 'Change' : 'Choose'}
        </span>
      </label>
      {file && (
        <>
          <span id={`${id}-hint`} className="sr-only">
            {hint}
          </span>
          <button type="button" className="slot-remove" onClick={() => onPick(slot, null)}>
            Remove<span className="sr-only"> {label}</span>
          </button>
        </>
      )}
      {error && (
        <p id={`${id}-err`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

function Checking({ step }: { step: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="kyc-checking" role="status" aria-live="polite" aria-busy="true">
      <span className="kyc-spinner" aria-hidden="true" />
      <h2 className="kyc-result-title">Checking your documents</h2>
      <ol className="kyc-progress">
        {PROGRESS.map((label, i) => (
          <li key={label} className={i < step ? 'is-done' : i === step ? 'is-current' : undefined}>
            {i < step ? <CheckIcon /> : <span className="kyc-progress-dot" aria-hidden="true" />}
            {label}
          </li>
        ))}
      </ol>
      <p className="kyc-wait">
        {elapsed < 45 ? 'This can take up to a minute. Please keep this page open.' : 'Almost there. Thanks for waiting.'}
      </p>
    </div>
  );
}
