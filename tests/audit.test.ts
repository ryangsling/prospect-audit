import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '../src/app/api/audit/route';
import { getPublicPage } from '../src/lib/clients/public-http';
import { readEnv } from '../src/lib/env';
import { fixture } from './fixture';

vi.mock('../src/lib/clients/public-http', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/lib/clients/public-http')>()),
  getPublicPage: vi.fn(),
}));

const get = vi.mocked(getPublicPage);
afterEach(() => vi.unstubAllEnvs());

const websiteUrl = 'https://salon.example/';
const post = (body: unknown) => POST(new Request('https://api.example/api/audit', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.stubEnv('APIFY_TOKEN', '');
  vi.stubEnv('GOOGLE_PLACES_API_KEY', '');
  vi.stubEnv('PAGESPEED_API_KEY', '');
  get.mockReset();
  get.mockImplementation(async url => {
    if (url.href === websiteUrl + 'robots.txt') return { status: 404, text: '' };
    if (url.href === websiteUrl) return { status: 200, contentType: 'text/html', text: fixture('fresha-salon') };
    throw new Error('Unexpected URL in fixture transport.');
  });
});

it('returns a website-only audit with measured checks and unavailable integrations', async () => {
  const response = await post({ websiteUrl, niche: 'salon', country: 'UK' });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    business: { name: null, websiteUrl, websiteTitle: 'Willow Salon', niche: 'salon', country: 'UK' },
    checks: [
      { id: 'booking', status: 'pass' }, { id: 'chatbot', status: 'fail' },
      { id: 'mobile_speed', status: 'not_checked' }, { id: 'after_hours', status: 'pass' },
      { id: 'reviews', status: 'not_checked' }, { id: 'hygiene', status: 'pass' },
    ],
    score: { value: 71, checkedWeight: 70 }, revenue: { currency: 'GBP' },
    fixes: ['Add a chat option so visitors can ask questions before they leave the website.'],
    scan: { pagesChecked: [websiteUrl], failures: [] },
  });
  expect(get).toHaveBeenCalledTimes(2);
});

it.each([
  {},
  { websiteUrl: 'file:///test' },
  { websiteUrl: ':invalid' },
  { websiteUrl: 'https://maps.app.goo.gl/sample' },
  { websiteUrl: 'https://example.com', country: 'invalid' },
])('rejects invalid website input before scanning (%j)', async body => {
  expect((await post(body)).status).toBe(400);
  expect(get).not.toHaveBeenCalled();
});

it('rejects malformed JSON', async () => {
  const response = await POST(new Request('https://api.example/api/audit', { method: 'POST', body: '{' }));
  expect(response.status).toBe(400);
  expect(get).not.toHaveBeenCalled();
});

it('loads defaults when credentials are absent or empty', () => {
  expect(readEnv({ AGENCY_NAME: '', APIFY_TOKEN: '', GOOGLE_PLACES_API_KEY: '' })).toMatchObject({
    APIFY_PLACES_ACTOR: 'compass~crawler-google-places',
    APIFY_TOKEN: undefined,
    GOOGLE_PLACES_API_KEY: undefined,
    AGENCY_NAME: 'Incodet',
    AGENCY_URL: 'https://incodet.com',
  });
});
