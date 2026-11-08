import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AppHeader } from '@/components/AppHeader';
import { SignOutButton } from '@/components/SignOutButton';
import { loadAdminMetrics } from '@/lib/admin/data';
import { parsePeriod } from '@/lib/admin/metrics';
import { currentUser } from '@/lib/auth/session';
import { BarList, Funnel, PeriodFilter, Section, TargetKpis, VolumeRow } from './AdminParts';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Admin dashboard — Accel Business' };

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect('/login?next=/admin');
  if (!user.isAdmin) redirect('/dashboard');

  const days = parsePeriod((await searchParams).days);
  const m = await loadAdminMetrics(days);

  return (
    <>
      <AppHeader href="/admin">
        <span className="app-email" title={user.email}>
          <span className="sr-only">Signed in as </span>
          {user.email}
        </span>
        <SignOutButton />
      </AppHeader>
      <main className="dash admin">
        <div className="admin-head">
          <div>
            <h1 className="dash-title">Admin dashboard</h1>
            <p className="dash-lead">The last {days} days, compared with the {days} days before.</p>
          </div>
          <PeriodFilter days={days} />
        </div>

        <Section id="kpis" title="Key metrics" sub="Targets for the digital journey. “Before” is the old sales-led process. Conversion is activations in the period over leads or accepted quotes in the period.">
          <TargetKpis kpis={m.kpis} days={days} />
        </Section>

        <Section id="volume" title="Volume">
          <VolumeRow {...m} />
        </Section>

        <Section id="funnel" title="Funnel" sub="Leads created in this period, by the furthest stage they reached.">
          <Funnel steps={m.funnel} />
        </Section>

        <div className="admin-grid">
          <Section id="bundles" title="Bundles accepted" sub="Quotes accepted in this period.">
            <BarList rows={m.bundles} label="Bundles accepted" />
          </Section>
          <Section id="kyc" title="KYC results" sub="Latest check for each lead checked in this period.">
            <BarList rows={m.kyc} label="KYC results" />
          </Section>
        </div>

        <Section id="segments" title="Leads by segment" sub="Leads created in this period, and how many of them were activated.">
          <BarList rows={m.segments} label="Leads by segment" />
        </Section>

        <Section id="closed" title="Closed leads" sub={`${m.closedTotal.toLocaleString('en-IN')} closed in this period.`}>
          <div className="admin-grid">
            <div>
              <h3 className="admin-h3">By reason</h3>
              <BarList rows={m.closedReasons} label="Closed leads by reason" />
            </div>
            <div>
              <h3 className="admin-h3">By stage when closed</h3>
              <BarList rows={m.closedStages} label="Closed leads by stage" />
            </div>
          </div>
        </Section>
      </main>
    </>
  );
}
