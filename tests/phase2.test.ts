import { afterEach, expect, it, vi } from 'vitest';
import { auditInputSchema } from '../src/lib/audit-input';
import { runAudit } from '../src/lib/audit';
import { detectAfterHours } from '../src/lib/checks/after-hours';
import { detectMobileSpeed } from '../src/lib/checks/mobile-speed';
import { detectReviews } from '../src/lib/checks/reviews';
import { scoreChecks } from '../src/lib/checks/score';
import type { CheckResult } from '../src/lib/checks/types';
import { apifyListing, apifyReviews, mapApifyHours, mapApifyListing, mapApifyReview } from '../src/lib/clients/apify';
import { weeklyClosedHours } from '../src/lib/clients/listing';
import { mobileSpeed } from '../src/lib/clients/pagespeed';
import { placesListing } from '../src/lib/clients/places';
import { readEnv } from '../src/lib/env';
import { defaultAssumptions, estimateRevenue } from '../src/lib/revenue';
import listingRows from './fixtures/apify/listing.synthetic.json';
import reviewRows from './fixtures/apify/reviews.synthetic.json';
import { fixture } from './fixture';

const listing = mapApifyListing(listingRows[0])!;
const reviews = reviewRows.map(row => mapApifyReview(row)!);
const fallbackRow = {
  id: listing.placeId, displayName: { text: 'Willow Salon' }, formattedAddress: listing.address,
  websiteUri: listing.website, userRatingCount: 105, rating: 4.6,
  addressComponents: [
    { longText: 'Bristol', shortText: 'Bristol', types: ['locality'] },
    { longText: 'United Kingdom', shortText: 'GB', types: ['country'] },
  ],
  regularOpeningHours: { periods: [{ open: { day: 6, hour: 22, minute: 0 }, close: { day: 0, hour: 2, minute: 0 } }] },
};

const speedRow = {
  lighthouseResult: {
    categories: { performance: { score: 0.38 } },
    audits: {
      'largest-contentful-paint': { numericValue: 6200 },
      'cumulative-layout-shift': { numericValue: 0.12 },
      'total-blocking-time': { numericValue: 440 },
    },
  },
  loadingExperience: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 195 } } },
};

const env = readEnv({
  APIFY_TOKEN: 'fixture-token', APIFY_PLACES_ACTOR: 'fixture~test-listing',
  APIFY_REVIEWS_ACTOR: 'fixture~test-reviews', GOOGLE_PLACES_API_KEY: 'fixture-places',
  PAGESPEED_API_KEY: 'fixture-speed',
});

afterEach(() => vi.unstubAllGlobals());

function mockProviderHttp() {
  const http = vi.fn(async (url: URL, init: RequestInit) => {
    if (url.hostname === 'api.apify.com') {
      return Response.json(url.pathname.includes('reviews') ? reviewRows : listingRows);
    }
    if (url.hostname === 'places.googleapis.com') {
      return Response.json(init.method === 'POST' ? { places: [fallbackRow] } : fallbackRow);
    }
    if (url.hostname === 'www.googleapis.com') return Response.json(speedRow);
    throw new Error('Unexpected provider in mocked network.');
  });
  vi.stubGlobal('fetch', http);
  return http;
}

function mockScan() {
  return vi.fn(async (url: URL) => {
    const homepage = { url: url.href, html: fixture('fresha-salon') };
    return { homepage, pages: [homepage], failures: [] };
  });
}

it('audits a website and maps both Apify actors and PageSpeed through mocked HTTP', async () => {
  const http = mockProviderHttp();
  const scanWebsite = mockScan();
  const result = await runAudit(auditInputSchema.parse({
    websiteUrl: listing.website, country: 'UK', niche: 'salon',
  }), { scanWebsite, mobileSpeed, apifyListing, apifyReviews, placesListing }, env);
  expect(result.business).toMatchObject({ name: 'Willow Salon', websiteUrl: listing.website, listingSource: 'apify' });
  expect(result.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'mobile_speed', status: 'fail', details: { score: 38, lcpMs: 6200, cls: 0.12, inpMs: 195, tbtMs: 440 } }),
    expect.objectContaining({ id: 'reviews', status: 'partial', details: expect.objectContaining({ responseRate: 50, negativeResponseRate: 33.3, newestUnansweredNegative: '2025-02-19T12:00:00.000Z' }) }),
    expect.objectContaining({ id: 'after_hours', status: 'pass', details: { weeklyClosedHours: 128 } }),
  ]));
  const listingRequest = http.mock.calls.find(([url]) => url.pathname.includes('test-listing'))!;
  const reviewsRequest = http.mock.calls.find(([url]) => url.pathname.includes('test-reviews'))!;
  const psiRequest = http.mock.calls.find(([url]) => url.hostname === 'www.googleapis.com')!;
  expect(JSON.parse(String(listingRequest[1].body))).toEqual({ searchStringsArray: ['Willow Salon salon.example United Kingdom'], maxCrawledPlacesPerSearch: 1 });
  expect(JSON.parse(String(reviewsRequest[1].body))).toMatchObject({ maxReviews: 30, reviewsSort: 'newest' });
  expect(psiRequest[0].searchParams.get('strategy')).toBe('mobile');
  expect(result.score).toEqual({ value: 58, grade: 'Losing customers', checkedWeight: 100 });
  expect(result.revenue.currency).toBe('GBP');

  await runAudit(auditInputSchema.parse({ websiteUrl: listing.website, country: 'UK', assumptions: { averageTicket: 100 } }),
    { scanWebsite, mobileSpeed, apifyListing, apifyReviews, placesListing }, env);
  expect(http.mock.calls.filter(([url]) => url.hostname === 'api.apify.com')).toHaveLength(2);
});

it.each([
  { mapsUrl: listing.mapsUrl },
  { businessName: 'Willow Salon', city: 'Bristol' },
])('resolves a website through the Places fallback from %j', async input => {
  const http = mockProviderHttp();
  const scanWebsite = mockScan();
  const failedApify = vi.fn(async () => { throw new Error('Actor unavailable'); });
  const result = await runAudit(auditInputSchema.parse({ ...input, country: 'UK' }), {
    scanWebsite, mobileSpeed, apifyListing: failedApify, apifyReviews, placesListing,
  }, env);
  expect(result.business).toMatchObject({ name: 'Willow Salon', websiteUrl: listing.website, listingSource: 'places' });
  expect(result.checks.find(check => check.id === 'reviews')).toMatchObject({ status: 'not_checked', evidence: 'Response rate not checked' });
  expect(result.checks.find(check => check.id === 'after_hours')?.details?.weeklyClosedHours).toBe(164);
  expect(http.mock.calls.some(([url]) => url.hostname === 'places.googleapis.com')).toBe(true);
  expect(http.mock.calls.some(([url]) => url.hostname === 'api.apify.com')).toBe(false);
});

it('ignores an unrelated website-only listing', async () => {
  const scanWebsite = mockScan();
  const skipped = vi.fn(async () => null);
  const result = await runAudit(auditInputSchema.parse({ websiteUrl: 'https://salon.example/', country: 'UK' }), {
    scanWebsite, mobileSpeed: vi.fn(), apifyListing: async () => ({ ...listing, website: 'https://different.example/' }),
    apifyReviews: vi.fn(), placesListing: skipped,
  }, readEnv({ APIFY_TOKEN: 'fixture-token' }));
  expect(result.business.name).toBeNull();
  expect(result.scan.listingIssue).toMatch(/could not be verified/);
  expect(skipped).toHaveBeenCalledOnce();
});

it('merges overlapping and overnight hours without double counting', () => {
  expect(weeklyClosedHours([{ start: 10020, end: 10140 }, { start: 30, end: 120 }])).toBe(165);
  expect(mapApifyHours([{ day: 'Monday', hours: 'No hours supplied' }])).toBeNull();
});

it('distinguishes after-hours phone-only contact and too small a review sample', () => {
  const homepage = { url: 'https://roofing.example', html: fixture('phone-only-roofing') };
  const check: CheckResult = { id: 'booking', label: 'Booking', status: 'fail', confidence: 'high', evidence: '' };
  const result = detectAfterHours({ homepage, pages: [homepage], failures: [] }, listing, check, { ...check, id: 'chatbot' });
  expect(result).toMatchObject({ status: 'fail', details: { weeklyClosedHours: 128 } });
  expect(detectReviews(listing, reviews.slice(0, 4), '')).toMatchObject({ status: 'not_checked', evidence: 'Too few reviews to judge' });
});

it.each([[49, 'fail'], [50, 'partial'], [69, 'partial'], [70, 'pass']] as const)('classifies speed score %d', (score, status) => {
  expect(detectMobileSpeed({ score, lcpMs: null, cls: null, inpMs: null, tbtMs: null }, '').status).toBe(status);
});

it('renormalizes checked weights and applies review size, currency, and all revenue components', () => {
  const check = (id: string, status: CheckResult['status']): CheckResult =>
    ({ id, label: id, status, confidence: 'medium', evidence: '' });
  const checks = [check('booking', 'fail'), check('chatbot', 'fail'), check('mobile_speed', 'fail'),
    check('after_hours', 'not_checked'), check('reviews', 'not_checked'), check('hygiene', 'pass')];
  expect(scoreChecks(checks)).toMatchObject({ value: 8, checkedWeight: 65 });
  expect(scoreChecks([check('booking', 'pass'), check('chatbot', 'partial'), check('reviews', 'not_checked')]))
    .toMatchObject({ value: 78, grade: 'Needs work' });
  expect(scoreChecks([check('booking', 'not_checked')])).toBeNull();
  const assumptions = defaultAssumptions('salon', 'UK', 1000, checks);
  expect(assumptions).toMatchObject({ averageTicket: 56, inquiriesPerMonth: 240 });
  expect(estimateRevenue(assumptions, checks, 'UK')).toMatchObject({
    components: { afterHours: 2016, slowSite: 336, noBooking: 672 },
    range: { low: 1800, high: 3650 },
  });
  expect(estimateRevenue(assumptions, [check('booking', 'not_checked')], 'UK').range).toBeNull();
});
