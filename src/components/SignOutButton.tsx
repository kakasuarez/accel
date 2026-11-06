'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from './api';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even if the call fails, leave the signed-in area; the proxy decides what the visitor may see.
    }
    router.replace('/');
    router.refresh();
  };

  return (
    <button type="button" className="btn btn-outline-dark btn-sm" onClick={signOut} disabled={busy}>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
