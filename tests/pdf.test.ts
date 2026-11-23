import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { POST } from '../src/app/api/audit/pdf/route';
import { createSession, passwordMatches, sessionSeconds, validSession } from '../src/lib/auth';
import { auditInputSchema } from '../src/lib/audit-input';
import { runAudit } from '../src/lib/audit';
import { readEnv } from '../src/lib/env';
import { outreachHook } from '../src/lib/outreach';
import { pdfInputSchema } from '../src/lib/pdf/input';
import { pdfFilename, renderAuditPdf } from '../src/lib/pdf/report';
import { fixture } from './fixture';

const cases = [
  { file: 'fresha-salon', name: 'Willow Salon', country: 'UK', niche: 'salon' },
  { file: 'phone-only-roofing', name: 'Harbor Roofing', country: 'US', niche: 'roofing' },
  { file: 'calendly', name: 'Studio Consultations and Wellness Appointments Across Multiple Neighbourhoods', country: 'AU', niche: 'spa' },
] as const;

describe('PDF fixture audits', () => {
  it.each(cases)('renders a one-page $country report from $file', async sample => {
    const input = auditInputSchema.parse({
      websiteUrl: 'https://business.example/', businessName: sample.name, country: sample.country,
      niche: sample.niche, firstName: 'Riley',
    });
    const result = await runAudit(input, {
      scanWebsite: async url => {
        const homepage = { url: url.href, html: fixture(sample.file) };
        return { homepage, pages: [homepage], failures: [] };
      },
      apifyListing: vi.fn(), apifyReviews: vi.fn(), placesListing: vi.fn(), mobileSpeed: vi.fn(),
    }, readEnv({}));
    const audit = pdfInputSchema.parse({ ...result, auditedAt: '2025-03-01T12:00:00.000Z' });
    const buffer = await renderAuditPdf(audit, readEnv({}));
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);
    const mediaBox = buffer.toString('latin1').match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
    const [width, height] = sample.country === 'US' ? [612, 792] : [595.28, 841.89];
    expect(Number(mediaBox?.[1])).toBeCloseTo(width);
    expect(Number(mediaBox?.[2])).toBeCloseTo(height);
    expect(pdfFilename(audit)).toMatch(/^audit-[a-z0-9-]+-2025-03-01\.pdf$/);
    if (process.env.WRITE_AUDIT_SAMPLES === '1') {
      await mkdir('samples', { recursive: true });
      await writeFile(join('samples', pdfFilename(audit)), buffer);
    }
    const response = await POST(new Request('http://localhost/api/audit/pdf', {
      method: 'POST', body: JSON.stringify(audit),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain(pdfFilename(audit));
  });

  it('rejects invalid PDF requests', async () => {
    const response = await POST(new Request('http://localhost/api/audit/pdf', {
      method: 'POST', body: '{}',
    }));
    expect(response.status).toBe(400);
  });
});

it('signs a session and rejects expiration, rotation, and a modified signature', async () => {
  const start = Date.UTC(2025, 0, 1);
  const password = 'fixture-password';
  const token = await createSession(password, start);
  expect(await passwordMatches(password, password)).toBe(true);
  expect(await passwordMatches(password + ' ', password)).toBe(false);
  expect(await validSession(token, password, start + 1000)).toBe(true);
  expect(await validSession(token, password, start + sessionSeconds * 1000)).toBe(false);
  expect(await validSession(token, 'rotated-fixture-password', start)).toBe(false);
  expect(await validSession(token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a'), password, start)).toBe(false);
});

it('builds the outreach line from the highest-weight failed check', () => {
  const checks = [
    { id: 'mobile_speed', label: 'Mobile speed', status: 'fail', confidence: 'high', evidence: 'Slow' },
    { id: 'booking', label: 'Booking', status: 'fail', confidence: 'medium', evidence: 'No booking' },
  ] as const;
  expect(outreachHook([...checks], 'Riley')).toMatch(/^Hi Riley, .*couldn’t find a way to book online/);
  expect(outreachHook([{ ...checks[0], status: 'not_checked' }], null)).toBeNull();
});
