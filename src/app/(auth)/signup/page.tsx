import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { safeNext } from '@/components/api';
import { signedInUser } from '../signedIn';
import { AuthForm } from '../AuthForm';

export const metadata: Metadata = { title: 'Create your account — Accel Business' };

export default async function SignupPage({ searchParams }: PageProps<'/signup'>) {
  const raw = (await searchParams).next;
  const next = safeNext(typeof raw === 'string' ? raw : null);
  if (await signedInUser()) redirect(next ?? '/dashboard');
  return <AuthForm mode="signup" next={next} />;
}
