import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AccountHeader } from '@/components/AccountHeader';
import { currentUser } from '@/lib/auth/session';
import { dashboardData } from '@/lib/dashboard/data';
import { BundleSummary, CurrentStep, History, Stepper } from './DashboardParts';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Your dashboard — Accel Business' };

export default async function DashboardPage() {
  const user = await currentUser();
  if (!user) redirect('/login?next=/dashboard');
  const { tracker, lead } = await dashboardData(user);

  return (
    <>
      <AccountHeader email={user.email} isAdmin={user.isAdmin} />
      <main className="dash">
        <h1 className="dash-title">{lead?.businessName ?? 'Your Accel connection'}</h1>

        <Stepper steps={tracker.steps} />
        <CurrentStep current={tracker.current} />

        {lead?.quote && <BundleSummary quote={lead.quote} />}
        {lead && lead.history.length > 0 && <History history={lead.history} />}
      </main>
    </>
  );
}
