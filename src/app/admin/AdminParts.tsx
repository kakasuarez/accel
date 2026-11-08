import Link from 'next/link';
import { formatRupees } from '@/lib/bot/script';
import { AlertIcon, CheckIcon } from '@/components/icons';
import type { Kpi as KpiType } from '@/lib/admin/kpis';
import { PERIODS, type Compared, type FunnelStep, type Period, type Row } from '@/lib/admin/metrics';

const percent = (n: number) => `${Math.round(n * 100)}%`;

/** "₹4.19 L", "₹1.03 Cr": big amounts in lakh and crore, so they fit a tile. Smaller ones in full. */
function compactRupees(amount: number): string {
  if (Math.abs(amount) >= 1e7) return `₹${(amount / 1e7).toFixed(2)} Cr`;
  if (Math.abs(amount) >= 1e5) return `₹${(amount / 1e5).toFixed(2)} L`;
  return formatRupees(amount);
}

export function PeriodFilter({ days }: { days: Period }) {
  return (
    <nav className="period" aria-label="Period">
      {PERIODS.map((p) => (
        <Link key={p} href={`/admin?days=${p}`} className={`period-link${p === days ? ' is-on' : ''}`} aria-current={p === days ? 'page' : undefined}>
          {p} days
        </Link>
      ))}
    </nav>
  );
}

/** "▲ 12% vs previous 30 days". */
function Change({ value, days }: { value: Compared; days: Period; kind: 'count' }) {
  const { current, previous } = value;
  let text: string;
  if (previous === 0) {
    text = current === 0 ? 'No change' : 'New this period';
  } else {
    const change = Math.round(((current - previous) / previous) * 100);
    text = change === 0 ? 'No change' : `${change > 0 ? '▲' : '▼'} ${Math.abs(change)}%`;
  }
  return (
    <span className="kpi-change">
      {text} <span>vs previous {days} days</span>
    </span>
  );
}

export function Kpi({ label, value, exact, change, note }: { label: string; value: string; exact?: string; change?: React.ReactNode; note?: string }) {
  return (
    <div className="kpi">
      <dt>{label}</dt>
      <dd>
        <strong title={exact}>{value}</strong>
        {change}
        {note && <span className="kpi-note">{note}</span>}
      </dd>
    </div>
  );
}

const formatKpi = (unit: KpiType['unit'], n: number) => (unit === 'percent' ? percent(n) : `${n.toFixed(1)} days`);

/** "▲ 4 pts vs previous 30 days" for rates, "▼ 1.5 days" for times. */
function KpiChange({ kpi, days }: { kpi: KpiType; days: Period }) {
  const { current, previous } = kpi;
  if (current.value === null || previous.value === null) return null;
  const diff = current.value - previous.value;
  const size = kpi.unit === 'percent' ? Math.round(Math.abs(diff) * 100) : Math.round(Math.abs(diff) * 10) / 10;
  const text = size === 0 ? 'No change' : `${diff > 0 ? '▲' : '▼'} ${size} ${kpi.unit === 'percent' ? 'pts' : size === 1 ? 'day' : 'days'}`;
  return (
    <span className="kpi-change">
      {text} <span>vs previous {days} days</span>
    </span>
  );
}

/** The KPIs with targets. Status is an icon and a word, never colour alone. "Off target" rather than "below", since less is better for time. */
export function TargetKpis({ kpis, days }: { kpis: readonly KpiType[]; days: Period }) {
  return (
    <dl className="kpis kpis-target">
      {kpis.map((kpi) => {
        const comparator = kpi.better === 'higher' ? '≥' : '≤';
        return (
          <div key={kpi.id} className="kpi">
            <dt>{kpi.label}</dt>
            <dd>
              <strong>{kpi.current.value === null ? '—' : formatKpi(kpi.unit, kpi.current.value)}</strong>
              {kpi.onTarget !== null && (
                <span className={`kpi-status${kpi.onTarget ? ' is-on' : ' is-off'}`}>
                  {kpi.onTarget ? <CheckIcon /> : <AlertIcon />}
                  {kpi.onTarget ? 'On target' : 'Off target'}
                </span>
              )}
              <span className="kpi-target">
                Target {comparator} {formatKpi(kpi.unit, kpi.target)}
                {kpi.baseline !== null && <> · Before: {formatKpi(kpi.unit, kpi.baseline)}</>}
              </span>
              <KpiChange kpi={kpi} days={days} />
              <span className="kpi-note">{kpi.current.value === null ? 'Nothing to measure in this period yet' : kpi.basis}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

export function VolumeRow(props: {
  days: Period;
  newLeads: Compared;
  activations: Compared;
  revenueWon: Compared;
  averageWon: Compared;
  pipeline: { leads: number; monthly: number };
}) {
  const { days } = props;
  return (
    <dl className="kpis kpis-volume">
      <Kpi label="New leads" value={props.newLeads.current.toLocaleString('en-IN')} change={<Change value={props.newLeads} days={days} kind="count" />} />
      <Kpi label="Activated" value={props.activations.current.toLocaleString('en-IN')} change={<Change value={props.activations} days={days} kind="count" />} />
      <Kpi
        label="Monthly revenue won"
        value={compactRupees(props.revenueWon.current)}
        exact={formatRupees(props.revenueWon.current)}
        change={<Change value={props.revenueWon} days={days} kind="count" />}
        note={props.activations.current ? `${formatRupees(props.averageWon.current)} a month per customer` : undefined}
      />
      <Kpi
        label="Open pipeline"
        value={compactRupees(props.pipeline.monthly)}
        exact={formatRupees(props.pipeline.monthly)}
        note={`A month, across ${props.pipeline.leads.toLocaleString('en-IN')} accepted quotes not yet activated`}
      />
    </dl>
  );
}

export function Section({ id, title, sub, children }: { id: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="admin-section" aria-labelledby={id}>
      <h2 id={id} className="dash-h2">
        {title}
      </h2>
      {sub && <p className="admin-sub">{sub}</p>}
      {children}
    </section>
  );
}

const Empty = () => <p className="admin-empty">Nothing in this period.</p>;

/** Horizontal bars, one per row, scaled to the largest value. The number is always printed beside the bar. */
export function BarList({ rows, label }: { rows: readonly Row[]; label: string }) {
  if (rows.length === 0 || rows.every((r) => r.value === 0)) return <Empty />;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <ul className="bars" aria-label={label}>
      {rows.map((row) => (
        <li key={row.label} className="bar-row" title={`${row.label}: ${row.value.toLocaleString('en-IN')}${row.detail ? ` (${row.detail})` : ''}`}>
          <span className="bar-label">
            {row.label}
            {row.detail && <span>{row.detail}</span>}
          </span>
          <span className="bar-track" aria-hidden="true">
            <span className="bar-fill" style={{ width: `${(row.value / max) * 100}%` }} />
          </span>
          <span className="bar-value">{row.value.toLocaleString('en-IN')}</span>
        </li>
      ))}
    </ul>
  );
}

export function Funnel({ steps }: { steps: readonly FunnelStep[] }) {
  if (!steps[0]?.count) return <Empty />;
  return (
    <BarList
      label="Leads reaching each stage"
      rows={steps.map((s) => ({
        label: s.stage,
        value: s.count,
        detail: s.fromPrevious === null ? 'All new leads' : `${percent(s.fromPrevious)} of the step before`,
      }))}
    />
  );
}
