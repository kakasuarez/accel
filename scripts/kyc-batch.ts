/**
 * Run the KYC validator on every applicant in kyc_documents/ (files named <ID>_<doc_type>.png)
 * and write reports/kyc_results.json plus a summary table on stdout.
 *
 *   npx tsx scripts/kyc-batch.ts [dir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateKyc } from '../src/lib/kyc/pipeline';
import { shutdownOcr } from '../src/lib/kyc/ocr/engine';
import { DOC_TYPES, type DocType, type KycResult } from '../src/lib/kyc/types';

const dir = process.argv[2] ?? 'kyc_documents';
const byApplicant = new Map<string, Partial<Record<DocType, Buffer>>>();
for (const name of fs.readdirSync(dir).sort()) {
  const m = name.match(/^([^_]+)_(.+)\.(png|jpe?g|webp)$/i);
  if (!m || !DOC_TYPES.includes(m[2] as DocType)) continue;
  const files = byApplicant.get(m[1]) ?? {};
  files[m[2] as DocType] = fs.readFileSync(path.join(dir, name));
  byApplicant.set(m[1], files);
}

const results: KycResult[] = [];
for (const [applicantId, files] of byApplicant) {
  const t0 = Date.now();
  const r = await validateKyc({ applicantId, files });
  results.push(r);
  const codes = r.findings.map((f) => `${f.code}${f.field ? `(${f.field})` : ''}[${f.severity.slice(0, 3)}]`).join(', ');
  console.log(`${applicantId.padEnd(5)} ${r.decision.padEnd(13)} ${String(Date.now() - t0).padStart(5)}ms  ${codes}`);
}
fs.mkdirSync('reports', { recursive: true });
fs.writeFileSync('reports/kyc_results.json', JSON.stringify(results, null, 2));
console.log(`\nWrote reports/kyc_results.json (${results.length} applicants)`);
await shutdownOcr();
