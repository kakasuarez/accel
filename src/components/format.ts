import { formatRupees } from '@/lib/bot/script';

/** "₹1,499" or "₹1,499–₹2,199" (en dash, no spaces). */
export function rupeeRange(min: number, max: number): string {
  return min === max ? formatRupees(min) : `${formatRupees(min)}–${formatRupees(max)}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "6 Nov 2026, 3:42 pm" in Indian time. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(d);
}

/** Catalogue units read "per site", "per line": turns quantity 3 + "per site" into "3 sites". */
export function quantityLabel(quantity: number, unit: string): string {
  const u = unit.trim().replace(/^per\s+/i, '');
  if (!u) return `× ${quantity}`;
  return `${quantity} ${u}${quantity === 1 || /s$/i.test(u) ? '' : 's'}`;
}
