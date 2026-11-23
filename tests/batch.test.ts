import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '../src/app/api/audit/batch/route';
import { makeBatchZip, parseLeads } from '../src/lib/batch';
import { batchApifyRunner } from '../src/lib/clients/apify';
import { getPublicPage } from '../src/lib/clients/public-http';
import { fixture } from './fixture';

vi.mock('../src/lib/clients/public-http', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/lib/clients/public-http')>()),
  getPublicPage: vi.fn(),
}));

const leads = readFileSync(new URL('../samples/leads.csv', import.meta.url), 'utf8');
const http = vi.mocked(getPublicPage);

beforeEach(() => {
  vi.stubEnv('APIFY_TOKEN', '');
  vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
  vi.stubEnv('PAGESPEED_API_KEY', '');
  http.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function csvRows(content: Uint8Array): Record<string, string>[] {
  return parse(strFromU8(content), { columns: true });
}

it('processes the sample upload at concurrency three and returns five single-page PDFs and results.csv', async () => {
  const sites: Record<string, string> = {
    'salon.example': 'fresha-salon',
    'roofing.example': 'phone-only-roofing',
    'studio.example': 'calendly',
    'dental.example': 'gtm-only',
    'spa.example': 'tidio',
  };
  let active = 0;
  let peak = 0;
  http.mockImplementation(async url => {
    if (url.pathname === '/robots.txt') return { status: 404, text: '' };
    const site = sites[url.hostname];
    if (!site || url.pathname !== '/') throw new Error('Unexpected fixture HTTP request.');
    active++;
    peak = Math.max(active, peak);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return { status: 200, contentType: 'text/html', text: fixture(site) };
  });
  const data = new FormData();
  data.append('file', new Blob([leads], { type: 'text/csv' }), 'leads.csv');
  const response = await POST(new Request('https://audit.example/api/audit/batch', { method: 'POST', body: data }));
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/zip');
  expect(peak).toBe(3);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const reports = Object.keys(files).filter(file => file.endsWith('.pdf'));
  expect(reports).toHaveLength(5);
  for (const file of reports) {
    const text = Buffer.from(files[file]).toString('latin1');
    expect(text.slice(0, 5)).toBe('%PDF-');
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(1);
  }
  const summary = csvRows(files['results.csv']);
  expect(summary.map(row => row.business)).toEqual([
    'Willow Salon', 'Harbor Roofing', 'Studio Consultations', 'Cedar Dental', 'Harbor Spa',
  ]);
  expect(summary[1]).toMatchObject({ top_issue: 'Online booking', hook: expect.stringMatching(/^Hi Sam,/) });
  expect(summary.every(row => row.score !== '' && row.revenue_high !== '')).toBe(true);
});

it('keeps duplicate names unique, preserves failed rows, and neutralizes spreadsheet formulas', async () => {
  const content = [
    'name,website,maps_url,city,country,niche,first_name',
    'Same,http://127.0.0.1,,,,,',
    'Same,http://127.0.0.1,,,,,',
    '"=missing, lead",,,,,,',
  ].join('\n');
  const output = await makeBatchZip(parseLeads(content), new AbortController().signal);
  const files = unzipSync(output);
  expect(Object.keys(files).filter(file => file.endsWith('.pdf'))).toHaveLength(2);
  expect(Object.keys(files).some(file => file.endsWith('-2.pdf'))).toBe(true);
  expect(csvRows(files['results.csv'])[2]).toMatchObject({
    business: "'=missing, lead", top_issue: expect.stringContaining('Enter a website'),
  });
});

it('captures an expired batch row and rejects malformed CSV uploads', async () => {
  const result = unzipSync(await makeBatchZip(parseLeads(leads), AbortSignal.abort()));
  expect(Object.keys(result)).toEqual(['results.csv']);
  expect(csvRows(result['results.csv'])).toHaveLength(5);
  const response = await POST(new Request('https://audit.example/api/audit/batch', {
    method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: 'unexpected\ntest',
  }));
  expect(response.status).toBe(400);
});

it('starts the batch Apify run asynchronously, polls it, and reads its finished dataset', async () => {
  const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
    if (init.method === 'POST') return Response.json({ data: { id: 'run123', status: 'RUNNING' } });
    if (url.pathname.endsWith('/run123')) {
      return Response.json({ data: { id: 'run123', status: 'SUCCEEDED', defaultDatasetId: 'dataset123' } });
    }
    if (url.pathname.includes('dataset123')) return Response.json([{ stars: 4 }]);
    throw new Error('Unexpected Apify call.');
  });
  vi.stubGlobal('fetch', fetchMock);
  const run = batchApifyRunner(new AbortController().signal);
  await expect(run('fixture~actor', { maxReviews: 30 }, 'fixture-token')).resolves.toEqual([{ stars: 4 }]);
  expect(fetchMock.mock.calls.map(([url]) => url.pathname)).toEqual([
    '/v2/acts/fixture~actor/runs', '/v2/actor-runs/run123', '/v2/datasets/dataset123/items',
  ]);
});
