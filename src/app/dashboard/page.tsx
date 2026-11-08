import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccountHeader } from '@/components/AccountHeader';
import { currentUser } from '@/lib/auth/session';
import { dashboardData } from '@/lib/dashboard/data';
import { BundleSummary, ConsentSection, CurrentStep, History, Stepper, UpdatesLine } from './DashboardParts';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Your dashboard — Accel Business' };

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/dashboard');
  const { tracker, lead, latestKyc } = await dashboardData(user);
  // Documents were only checked after the customer ticked the consent box on the KYC page.
  const checkedDocuments = latestKyc != null || lead?.stage === 'KYC complete' || lead?.stage === 'Activated';

  return (
    <>
      <AccountHeader email={user.email} isAdmin={user.isAdmin} />
      <main className="dash">
        <h1 className="dash-title">{lead?.businessName ?? 'Your Accel connection'}</h1>

        <Stepper steps={tracker.steps} />
        {lead && <UpdatesLine history={lead.history} />}
        <CurrentStep current={tracker.current} escalation={tracker.escalation} />

        {lead?.quote && <BundleSummary quote={lead.quote} />}
        {lead && lead.history.length > 0 && <History history={lead.history} />}
        {lead && <ConsentSection leadId={lead.id} email={user.email} checkedDocuments={checkedDocuments} />}
      </main>
    </>
  );
}
