import type { Metadata, Viewport } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';
import { resumableLeadId } from '@/lib/dashboard/data';
import { AccelBot } from './AccelBot';
import './bot.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Accel Bot — Find your business bundle',
  description: 'Answer a few quick questions and Accel Bot recommends a connectivity bundle for your business.',
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  interactiveWidget: 'resizes-content',
};

export default async function BotPage({ searchParams }: PageProps<'/bot'>) {
  const params = await searchParams;
  const lead = typeof params.lead === 'string' && params.lead ? params.lead : null;
  const fresh = params.new != null;

  const user = await currentUser();
  if (!user) {
    const query = lead ? `?lead=${encodeURIComponent(lead)}` : fresh ? '?new=1' : '';
    redirect(`/login?next=${encodeURIComponent(`/bot${query}`)}`);
  }

  if (!lead && !fresh) {
    const id = await resumableLeadId(user);
    if (id) redirect(`/bot?lead=${encodeURIComponent(id)}`);
  }

  return <AccelBot leadId={lead} />;
}
