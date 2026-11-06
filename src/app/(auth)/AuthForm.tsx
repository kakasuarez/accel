'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { api, ApiFailure } from '@/components/api';
import { AlertIcon } from '@/components/icons';

type Mode = 'login' | 'signup';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

const COPY = {
  login: {
    title: 'Log in',
    lead: 'Pick up your bundle, documents and connection where you left off.',
    submit: 'Log in',
    busy: 'Logging in…',
    switchText: 'New to Accel Business?',
    switchLink: 'Create an account',
    switchHref: '/signup',
  },
  signup: {
    title: 'Create your account',
    lead: 'One account for your bundle, your business verification and your connection.',
    submit: 'Create account',
    busy: 'Creating your account…',
    switchText: 'Already have an account?',
    switchLink: 'Log in',
    switchHref: '/login',
  },
} as const;

export function AuthForm({ mode, next }: { mode: Mode; next: string | null }) {
  const router = useRouter();
  const copy = COPY[mode];
  const id = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [confirmEmail, setConfirmEmail] = useState(false);

  const switchHref = next ? `${copy.switchHref}?next=${encodeURIComponent(next)}` : copy.switchHref;

  const validate = () => {
    const errs: typeof fieldErrors = {};
    if (!EMAIL.test(email.trim())) errs.email = 'Enter your email address, like name@business.in.';
    if (mode === 'signup' && password.length < MIN_PASSWORD) errs.password = `Use at least ${MIN_PASSWORD} characters.`;
    if (mode === 'login' && !password) errs.password = 'Enter your password.';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      await api(`/api/auth/${mode}`, { method: 'POST', json: { email: email.trim(), password } });
      if (mode === 'signup') {
        // If the project requires email confirmation, sign-up succeeds without a session.
        const signedIn = await api('/api/auth/me').then(
          () => true,
          () => false,
        );
        if (!signedIn) {
          setConfirmEmail(true);
          setBusy(false);
          return;
        }
      }
      router.replace(next ?? '/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  if (confirmEmail) {
    return (
      <section className="auth-card" aria-labelledby={`${id}-title`}>
        <h1 id={`${id}-title`} className="auth-title">
          Check your email
        </h1>
        <p className="auth-lead" role="status">
          We’ve sent a confirmation link to <strong>{email.trim()}</strong>. Open it, then log in here.
        </p>
        <Link href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} className="btn btn-primary auth-submit">
          Go to log in
        </Link>
      </section>
    );
  }

  return (
    <section className="auth-card" aria-labelledby={`${id}-title`}>
      <h1 id={`${id}-title`} className="auth-title">
        {copy.title}
      </h1>
      <p className="auth-lead">{copy.lead}</p>

      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {error && (
          <p className="form-alert" role="alert">
            <AlertIcon />
            <span>{error}</span>
          </p>
        )}

        <div className="field">
          <label htmlFor={`${id}-email`}>Email</label>
          <input
            id={`${id}-email`}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? `${id}-email-err` : undefined}
            required
          />
          {fieldErrors.email && (
            <p id={`${id}-email-err`} className="field-error">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={`${id}-password`}>Password</label>
          <div className="field-password">
            <input
              id={`${id}-password`}
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
              aria-describedby={
                [fieldErrors.password ? `${id}-password-err` : '', mode === 'signup' ? `${id}-password-hint` : '']
                  .filter(Boolean)
                  .join(' ') || undefined
              }
              minLength={mode === 'signup' ? MIN_PASSWORD : undefined}
              maxLength={72}
              required
            />
            <button
              type="button"
              className="field-reveal"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {mode === 'signup' && !fieldErrors.password && (
            <p id={`${id}-password-hint`} className="field-hint">
              At least {MIN_PASSWORD} characters.
            </p>
          )}
          {fieldErrors.password && (
            <p id={`${id}-password-err`} className="field-error">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
          {busy ? copy.busy : copy.submit}
        </button>
      </form>

      <p className="auth-switch">
        {copy.switchText} <Link href={switchHref}>{copy.switchLink}</Link>
      </p>
    </section>
  );
}
