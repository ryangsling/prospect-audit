import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { strToU8, zipSync } from 'fflate';
import { auditInputSchema, type AuditInput } from './audit-input';
import { runAudit } from './audit';
import { apifyListing, apifyReviews, batchApifyRunner } from './clients/apify';
import { mobileSpeed } from './clients/pagespeed';
import { placesListing } from './clients/places';
import { scanWebsite } from './clients/website';
import { readEnv } from './env';
import { outreachHook, worstFinding } from './outreach';
import { pdfInputSchema } from './pdf/input';
import { pdfFilename, renderAuditPdf } from './pdf/report';

export const maxCsvBytes = 128 * 1024;
export const maxBatchRows = 100;
const concurrency = 3;
const inputColumns = ['name', 'website', 'maps_url', 'city', 'country', 'niche', 'first_name'];
const outputColumns = ['business', 'score', 'revenue_low', 'revenue_high', 'top_issue', 'hook'];

export class BatchInputError extends Error {}

type Lead = { label: string; input: AuditInput } | { label: string; error: string };
type Row = Record<typeof outputColumns[number], string | number>;
type Processed = { row: Row; file?: { name: string; bytes: Uint8Array } };

export function parseLeads(text: string): Lead[] {
  if (Buffer.byteLength(text) > maxCsvBytes) throw new BatchInputError('CSV files must be 128 KiB or smaller.');
  let raw: Record<string, string>[];
  try {
    raw = parse(text, {
      bom: true, skip_empty_lines: true, trim: true, max_record_size: 8192,
      columns: (headers: string[]) => {
        const names = headers.map(header => header.trim().toLowerCase());
        if (new Set(names).size !== names.length || names.some(name => !inputColumns.includes(name))) {
          throw new BatchInputError('Use the documented CSV column names without duplicates.');
        }
        return names;
      },
    });
  } catch (error) {
    if (error instanceof BatchInputError) throw error;
    throw new BatchInputError('The file is not a readable CSV. Check quoting and column counts.');
  }
  if (!raw.length) throw new BatchInputError('The CSV must contain at least one lead.');
  if (raw.length > maxBatchRows) throw new BatchInputError(`Upload up to ${maxBatchRows} leads at a time.`);

  return raw.map((row, index) => {
    const label = row.name || row.website || row.maps_url || `Lead ${index + 1}`;
    const result = auditInputSchema.safeParse({
      businessName: row.name || undefined, websiteUrl: row.website || undefined, mapsUrl: row.maps_url || undefined,
      city: row.city || undefined, country: row.country?.toUpperCase() || undefined,
      niche: row.niche?.toLowerCase() || undefined, firstName: row.first_name || undefined,
    });
    return result.success ? { label, input: result.data }
      : { label, error: result.error.issues.map(issue => issue.message).join(' ') };
  });
}

type Audit = (input: AuditInput) => ReturnType<typeof runAudit>;

function batchAudit(signal: AbortSignal): Audit {
  const env = readEnv();
  const actor = batchApifyRunner(signal);
  return input => runAudit(input, {
    scanWebsite: url => scanWebsite(url, undefined, signal),
    apifyListing: (query, config) => apifyListing(query, config, actor),
    apifyReviews: (listing, config) => apifyReviews(listing, config, actor),
    placesListing: (query, key) => placesListing(query, key, signal),
    mobileSpeed: (url, key) => mobileSpeed(url, key, signal),
  }, env);
}

function issue(label: string, explanation: string): Processed {
  return { row: { business: label, score: '', revenue_low: '', revenue_high: '', top_issue: explanation, hook: '' } };
}

async function processLead(lead: Lead, signal: AbortSignal, audit: Audit): Promise<Processed> {
  if ('error' in lead) return issue(lead.label, lead.error);
  if (signal.aborted) return issue(lead.label, 'The batch reached its time limit.');
  try {
    const result = await audit(lead.input);
    if (signal.aborted) return issue(lead.label, 'The batch reached its time limit.');
    const pdf = pdfInputSchema.parse(result);
    const bytes = await renderAuditPdf(pdf);
    return {
      row: {
        business: result.business.name ?? result.business.websiteTitle ?? lead.label,
        score: result.score?.value ?? '',
        revenue_low: result.revenue.range?.low ?? '',
        revenue_high: result.revenue.range?.high ?? '',
        top_issue: worstFinding(result.checks)?.label ?? '',
        hook: outreachHook(result.checks, result.business.firstName) ?? '',
      },
      file: { name: pdfFilename(pdf), bytes },
    };
  } catch {
    return issue(lead.label, 'The audit could not be generated.');
  }
}

export async function makeBatchZip(leads: Lead[], signal: AbortSignal, audit = batchAudit(signal)) {
  const output: Processed[] = new Array(leads.length);
  let next = 0;
  async function worker() {
    while (next < leads.length) {
      const index = next++;
      output[index] = await processLead(leads[index], signal, audit);
    }
  }
  await Promise.all(Array.from({ length: Math.min(leads.length, concurrency) }, worker));

  const archive: Record<string, Uint8Array> = {};
  for (const { file } of output) {
    if (!file) continue;
    let name = file.name;
    for (let duplicate = 2; Object.hasOwn(archive, name); duplicate++) {
      name = file.name.replace(/\.pdf$/, `-${duplicate}.pdf`);
    }
    archive[name] = file.bytes;
  }
  const results = stringify(output.map(({ row }) => row), { header: true, columns: outputColumns, escape_formulas: true });
  archive['results.csv'] = strToU8(results);
  return zipSync(archive, { level: 3 });
}
