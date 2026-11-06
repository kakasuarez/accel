'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
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

/** Slow steps of the check, shown in turn while it runs. They are the engine's real stages. */
const PROGRESS = ['Reading your documents', 'Checking the GST and Udyam registries', 'Matching names, addresses and dates'];

type Files = Partial<Record<DocType, File>>;
type Phase = { kind: 'form' } | { kind: 'checking' } | { kind: 'approved' } | { kind: 'review'; check: KycCheck | null };

interface Props {
  leadId: string;
  hasGstin: boolean | undefined;
  previous: KycCheck | null;
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function KycForm({ leadId, hasGstin, previous }: Props) {
  const router = useRouter();
  const [files, setFiles] = useState<Files>({});
  const [slotErrors, setSlotErrors] = useState<Partial<Record<DocType, string>>>({});
  const [phase, setPhase] = useState<Phase>({ kind: 'form' });
  const [rejected, setRejected] = useState<KycCheck | null>(previous);
  const [error, setError] = useState<{ message: string; toDashboard?: boolean } | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const hasRegistration = !!(files.gst_certificate || files.udyam_certificate);
  const ready = hasRegistration && !!files.signatory_id && !!files.address_proof;

  const missing = [
    !hasRegistration && 'a GST or Udyam certificate',
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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setPhase({ kind: 'checking' });
    const form = new FormData();
    (Object.keys(files) as DocType[]).forEach((slot) => {
      const file = files[slot];
      if (file) form.append(slot, file, file.name);
    });
    try {
      const check = await api<KycCheck>(`/api/leads/${encodeURIComponent(leadId)}/kyc`, { method: 'POST', body: form });
      if (check.decision === 'APPROVE') setPhase({ kind: 'approved' });
      else if (check.decision === 'MANUAL_REVIEW') setPhase({ kind: 'review', check });
      else {
        setRejected(check);
        setPhase({ kind: 'form' });
      }
      router.refresh();
    } catch (err) {
      const failure = err instanceof ApiFailure ? err : null;
      if (failure?.code === 'under_review') {
        setPhase({ kind: 'review', check: null });
        return;
      }
      setPhase({ kind: 'form' });
      setError({
        message: failure?.message ?? 'Something went wrong while checking your documents. Please try again.',
        toDashboard: failure?.code === 'not_ready' || failure?.code === 'closed',
      });
    }
  };

  // Move focus to the outcome so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (phase.kind !== 'form' || rejected !== previous) resultRef.current?.focus();
  }, [phase.kind, rejected, previous]);

  if (phase.kind === 'checking') return <Checking />;

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
    const notes = phase.check?.findings.filter((f) => f.severity === 'REVIEW') ?? [];
    return (
      <div className="kyc-result is-review" ref={resultRef} tabIndex={-1} role="status">
        <span className="kyc-result-mark" aria-hidden="true">
          <ClockIcon />
        </span>
        <h2 className="kyc-result-title">Your documents are under review</h2>
        <p>A few details need a person to check them. We’ll update your dashboard when it’s done; there’s nothing more to upload.</p>
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
        <Link href="/dashboard" className="btn btn-primary">
          Back to dashboard
          <ArrowIcon />
        </Link>
      </div>
    );
  }

  return (
    <>
      {rejected && <Rejected check={rejected} fresh={rejected !== previous} innerRef={resultRef} />}

      <form className="kyc-form" onSubmit={submit} noValidate aria-describedby="kyc-privacy">
        <fieldset className="kyc-group">
          <legend>
            Business registration <span className="kyc-need">GST or Udyam, at least one</span>
          </legend>
          {hasGstin === false && (
            <p className="kyc-hint">
              <InfoIcon /> Not registered for GST? Upload your Udyam certificate.
            </p>
          )}
          <Slot
            slot="gst_certificate"
            label="GST certificate"
            hint="Or upload your Udyam certificate below."
            file={files.gst_certificate}
            error={slotErrors.gst_certificate}
            onPick={pick}
          />
          <Slot
            slot="udyam_certificate"
            label="Udyam certificate"
            hint="Or upload your GST certificate above."
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
            Your documents are checked in memory and are not stored. We keep only the result and the reasons for it.
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
        </div>
      </form>
    </>
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

function Checking() {
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = window.setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      setElapsed(s);
      setStep(Math.min(PROGRESS.length - 1, Math.floor(s / 9)));
    }, 1000);
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
