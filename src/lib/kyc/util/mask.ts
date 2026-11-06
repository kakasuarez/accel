/** Masking for identifiers shown in logs, reports and the UI (DPDP: data minimisation). */

/** GSTIN: keep state code and the last 3 characters; hide the embedded PAN. 37IHKXV5167L1ZS → 37**********1ZS */
export function maskGstin(g: string | null | undefined): string | null {
  if (!g) return null;
  if (g.length < 6) return '*'.repeat(g.length);
  return g.slice(0, 2) + '*'.repeat(g.length - 5) + g.slice(-3);
}

/** Udyam: keep prefix, state and last 4 digits. UDYAM-AP-00-9751562 → UDYAM-AP-00-***1562 */
export function maskUdyam(u: string | null | undefined): string | null {
  if (!u) return null;
  const m = u.match(/^(UDYAM-[A-Z]{2}-\d{2}-)(\d*)(\d{4})$/);
  if (!m) return maskTail(u, 4);
  return m[1] + '*'.repeat(m[2].length) + m[3];
}

/** Generic: keep the last `keep` characters. SYN-ID-346190 → *********190 (keep 3) */
export function maskTail(s: string | null | undefined, keep = 4): string | null {
  if (!s) return null;
  if (s.length <= keep) return '*'.repeat(s.length);
  return '*'.repeat(s.length - keep) + s.slice(-keep);
}

/** Replace anything that looks like a GSTIN, Udyam number or long digit run in free text (for log lines). */
export function maskText(s: string): string {
  return s
    .replace(/\b\d{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]\b/g, (g) => maskGstin(g) ?? '')
    .replace(/\bUDYAM-[A-Z]{2}-\d{2}-\d{7}\b/g, (u) => maskUdyam(u) ?? '')
    .replace(/\b\d{8,}\b/g, (d) => maskTail(d, 4) ?? '');
}
