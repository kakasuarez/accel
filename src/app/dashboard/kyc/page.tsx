import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AccountHeader } from '@/components/AccountHeader';
import { currentUser } from '@/lib/auth/session';
import { latestKycCheck, type KycCheck } from '@/lib/kyc/store';
import { ownLead } from '@/lib/leads/access';
import type { LeadRow } from '@/lib/leads/repository';
import { KycForm } from './KycForm';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Verify your business — Accel Business' };

export default async function KycPage({ searchParams }: PageProps<'/dashboard/kyc'>) {
  const raw = (await searchParams).lead;
  const leadId = typeof raw === 'string' ? raw : '';
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/dashboard/kyc?lead=${leadId}`)}`);

  let lead: LeadRow | null = null;
  let latest: KycCheck | null = null;
  try {
    lead = await ownLead(user, leadId);
    latest = await latestKycCheck(lead.id);
  } catch {
    lead = null;
  }
  if (!lead || lead.stage !== 'Quote accepted' || lead.status === 'closed' || latest?.decision === 'APPROVE') {
    redirect('/dashboard');
  }

  const hasGstin = typeof lead.answers.hasGstin === 'boolean' ? lead.answers.hasGstin : undefined;

  return (
    <>
      <AccountHeader email={user.email} />
      <main className="dash kyc">
        <Link href="/dashboard" className="back-link">
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Dashboard
        </Link>
        <h1 className="dash-title">Verify your business</h1>
        <p className="dash-lead">
          Upload clear photos or scans of your documents. We read them and check them against the GST and Udyam registries, so
          there’s no paperwork or visit.
        </p>
        <KycForm leadId={lead.id} hasGstin={hasGstin} previous={latest} />
      </main>
    </>
  );
}
