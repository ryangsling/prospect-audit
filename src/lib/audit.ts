import { load } from 'cheerio';
import { countryNames } from '../config/currency';
import type { AuditInput } from './audit-input';
import { detectAfterHours } from './checks/after-hours';
import { detectBooking } from './checks/booking';
import { detectChatbot } from './checks/chatbot';
import { detectHygiene } from './checks/hygiene';
import { detectMobileSpeed } from './checks/mobile-speed';
import { detectReviews } from './checks/reviews';
import { scoreChecks } from './checks/score';
import { apifyListing, apifyReviews } from './clients/apify';
import type { Listing, ListingQuery } from './clients/listing';
import { mobileSpeed } from './clients/pagespeed';
import { mapsSearchText, placesListing } from './clients/places';
import { isWebsiteUrl } from './clients/public-url';
import { scanWebsite, type WebsiteScan } from './clients/website';
import { readEnv } from './env';
import { auditFixes } from './fixes';
import { defaultAssumptions, estimateRevenue } from './revenue';

const emptyScan: WebsiteScan = { homepage: null, pages: [], failures: [] };

function websiteUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (isWebsiteUrl(url)) {
      url.hash = '';
      return url;
    }
  } catch {
    // A provider can return an unavailable or invalid website.
  }
  return null;
}

function titleOf(scan: WebsiteScan) {
  return scan.homepage
    ? load(scan.homepage.html)('head > title').first().text().replace(/\s+/g, ' ').trim().slice(0, 240) || null
    : null;
}

function normalized(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function includesPhrase(haystack: string, phrase: string) {
  return Boolean(phrase) && ` ${haystack} `.includes(` ${phrase} `);
}

function matches(listing: Listing, input: AuditInput, site: URL | null, title: string | null) {
  const listedCountry = listing.countryCode?.toUpperCase();
  const country = input.country === 'UK' ? 'GB' : input.country;
  if (listedCountry && listedCountry !== country && !(country === 'GB' && listedCountry === 'UK')) return false;
  const name = normalized(listing.name ?? '');
  if (input.mapsUrl) {
    const url = new URL(input.mapsUrl);
    const id = url.searchParams.get('query_place_id') ?? url.searchParams.get('q')?.match(/^place_id:(.+)$/)?.[1];
    if (id) return listing.placeId === id;
    if (listing.source === 'apify') return true;
    const query = normalized(mapsSearchText(url) ?? '');
    return includesPhrase(query, name);
  }
  if (input.businessName && input.city) {
    const location = normalized([listing.city, listing.address].filter(Boolean).join(' '));
    return name === normalized(input.businessName) && includesPhrase(location, normalized(input.city));
  }
  const providerWebsite = websiteUrl(listing.website);
  const host = (url: URL) => url.hostname.replace(/^www\.|\.$/g, '');
  if (site && providerWebsite) return host(site) === host(providerWebsite);
  return name.split(' ').length >= 2 && Boolean(title && title.split(/\s+[|–—-]\s+|\s*\|\s*/).some(part => normalized(part) === name));
}

const services = { scanWebsite, apifyListing, apifyReviews, placesListing, mobileSpeed };
type AuditServices = typeof services;

export async function runAudit(input: AuditInput, clients: AuditServices = services, env = readEnv()) {
  const givenWebsite = websiteUrl(input.websiteUrl);
  const givenScan = givenWebsite ? clients.scanWebsite(givenWebsite) : null;
  const speedFor = (site: URL) => env.PAGESPEED_API_KEY
    ? clients.mobileSpeed(site, env.PAGESPEED_API_KEY).catch(() => null)
    : Promise.resolve(null);
  const givenSpeed = givenWebsite ? speedFor(givenWebsite) : null;
  const listingConfigured = Boolean(env.APIFY_TOKEN || env.GOOGLE_PLACES_API_KEY);

  async function findListing() {
    if (!listingConfigured) return null;
    const scan = input.mapsUrl || (input.businessName && input.city) ? null : await givenScan;
    const site = websiteUrl(scan?.homepage?.url) ?? givenWebsite;
    const title = scan ? titleOf(scan) : null;
    const country = input.country === 'UK' ? 'GB' : input.country;
    const text = input.businessName && input.city
      ? [input.businessName, input.city, countryNames[input.country]].join(', ')
      : [title, site?.hostname, input.city, countryNames[input.country]].filter(Boolean).join(' ');
    const query: ListingQuery = input.mapsUrl
      ? { mapsUrl: input.mapsUrl, country, text: input.businessName && input.city ? text : undefined }
      : { text, country };
    const primary = await clients.apifyListing(query, env).catch(() => null);
    if (primary && matches(primary, input, site, title)) return primary;
    const fallback = await clients.placesListing(query, env.GOOGLE_PLACES_API_KEY).catch(() => null);
    return fallback && matches(fallback, input, site, title) ? fallback : null;
  }

  const resolved = findListing();
  const reviewsTask = resolved.then(async listing => {
    if (!listing || listing.source !== 'apify' || !listing.placeId || !env.APIFY_TOKEN) return null;
    if (listing.reviewCount !== null && listing.reviewCount < 5) return [];
    return clients.apifyReviews(listing, env).catch(() => null);
  });
  const siteTask = givenWebsite ? Promise.resolve(givenWebsite) : resolved.then(listing => websiteUrl(listing?.website));
  const [listing, site, scan, metrics, reviews] = await Promise.all([
    resolved, siteTask,
    givenScan ?? siteTask.then(url => url ? clients.scanWebsite(url) : emptyScan),
    givenSpeed ?? siteTask.then(url => url ? speedFor(url) : null),
    reviewsTask,
  ]);

  const booking = detectBooking(scan);
  const chat = detectChatbot(scan);
  const listingReason = listingConfigured ? 'A matching listing could not be verified.' : 'Listing lookup is unconfigured.';
  const checks = [
    booking,
    chat,
    detectMobileSpeed(metrics, !site ? 'No website URL could be resolved.' : !env.PAGESPEED_API_KEY
      ? 'PageSpeed is unconfigured.' : 'PageSpeed did not return usable mobile measurements.'),
    detectAfterHours(scan, listing, booking, chat),
    detectReviews(listing, reviews, listing?.source === 'places' ? 'Response rate not checked'
      : listing ? 'Review responses could not be retrieved.' : listingReason),
    detectHygiene(scan),
  ];

  const assumptions = {
    ...defaultAssumptions(input.niche, input.country, listing?.reviewCount ?? null, checks),
    ...input.assumptions,
  };
  return {
    business: {
      name: listing?.name ?? input.businessName ?? null,
      address: listing?.address ?? null,
      city: listing?.city ?? input.city ?? null,
      websiteUrl: scan.homepage?.url ?? site?.href ?? null,
      websiteTitle: titleOf(scan),
      mapsUrl: listing?.mapsUrl ?? input.mapsUrl ?? null,
      placeId: listing?.placeId ?? null,
      phone: listing?.phone ?? null,
      rating: listing?.rating ?? null,
      reviewCount: listing?.reviewCount ?? null,
      listingSource: listing?.source ?? null,
      niche: input.niche,
      country: input.country,
      firstName: input.firstName ?? null,
    },
    checks,
    score: scoreChecks(checks),
    revenue: estimateRevenue(assumptions, checks, input.country),
    fixes: auditFixes(checks),
    scan: {
      pagesChecked: scan.pages.map(page => page.url),
      failures: scan.failures,
      listingIssue: listing ? null : listingReason,
    },
    auditedAt: new Date().toISOString(),
  };
}

export type AuditResult = Awaited<ReturnType<typeof runAudit>>;
