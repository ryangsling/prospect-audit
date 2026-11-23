import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { readEnv } from '../env';
import { requestJson } from './json-http';
import type { Listing, ListingQuery, OpeningPeriod, Review } from './listing';

type ApifyEnv = Pick<ReturnType<typeof readEnv>, 'APIFY_TOKEN' | 'APIFY_PLACES_ACTOR' | 'APIFY_REVIEWS_ACTOR'>;
export type ActorRunner = (actor: string, input: object, token: string) => Promise<unknown>;
const timeout = 120_000;

export const runApifyActor: ActorRunner = (actor, input, token) => {
  const url = new URL(`https://api.apify.com/v2/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items`);
  url.searchParams.set('timeout', '120');
  return requestJson(url, timeout, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
};

const actorRun = z.object({
  data: z.object({ id: z.string().regex(/^[a-z0-9]+$/i), status: z.string(),
    defaultDatasetId: z.string().regex(/^[a-z0-9]+$/i).optional() }),
});

export function batchApifyRunner(batchSignal: AbortSignal): ActorRunner {
  return async (actor, input, token) => {
    const base = 'https://api.apify.com';
    const signal = AbortSignal.any([batchSignal, AbortSignal.timeout(timeout)]);
    const headers = { Authorization: `Bearer ${token}` };
    const start = new URL(`/v2/acts/${encodeURIComponent(actor)}/runs`, base);
    start.searchParams.set('timeout', '120');
    let run = actorRun.parse(await requestJson(start, timeout, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal,
    })).data;

    const runStatus = new URL(`/v2/actor-runs/${run.id}`, base);
    while (['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING'].includes(run.status)) {
      await delay(1000, undefined, { signal });
      run = actorRun.parse(await requestJson(runStatus, timeout, { headers, signal })).data;
    }
    if (run.status !== 'SUCCEEDED' || !run.defaultDatasetId) throw new Error('Apify actor did not complete successfully.');
    const dataset = new URL(`/v2/datasets/${run.defaultDatasetId}/items?clean=true`, base);
    return requestJson(dataset, timeout, { headers, signal });
  };
}

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayMinutes = 1440;

function time(raw: string, fallbackPeriod?: string) {
  const match = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)?$/i);
  if (!match) return null;
  const [, hours, minutes = '00', period = fallbackPeriod] = match;
  const hour = Number(hours);
  const minute = Number(minutes);
  if (minute > 59 || (period ? hour < 1 || hour > 12 : hour > 24 || (hour === 24 && minute > 0))) return null;
  if (!period && !raw.includes(':')) return null;
  return (period ? (hour % 12) + (period.toLowerCase() === 'pm' ? 12 : 0) : hour) * 60 + minute;
}

export function mapApifyHours(rows: { day: string; hours: string }[]): OpeningPeriod[] | null {
  const seen = new Set<number>();
  const periods: OpeningPeriod[] = [];
  for (const row of rows) {
    const day = weekdays.findIndex(value => value.toLowerCase() === row.day.trim().toLowerCase());
    if (day < 0 || seen.has(day)) return null;
    seen.add(day);
    const base = day * dayMinutes;
    const hours = row.hours.trim().replace(/[\u202f\u00a0]/g, ' ');
    if (/^closed$/i.test(hours)) continue;
    if (/^(?:open )?24 hours$/i.test(hours)) {
      periods.push({ start: base, end: base + dayMinutes });
      continue;
    }
    for (const interval of hours.split(/[,;]/)) {
      const [from, to, ...rest] = interval.split(/[-–—]/);
      if (!to || rest.length) return null;
      const end = time(to);
      const explicitStart = time(from);
      let start = explicitStart ?? time(from, to.trim().match(/([ap]m)$/i)?.[1]);
      if (start === null || end === null || start >= dayMinutes) return null;
      if (explicitStart === null && start >= end) start = (start + 720) % dayMinutes;
      if (start === end) return null;
      periods.push({ start: base + start, end: base + end + (end < start ? dayMinutes : 0) });
    }
  }
  return seen.size === 7 ? periods : null;
}

const text = z.string().trim().min(1).nullish().catch(null);
const count = z.number().int().nonnegative().nullish().catch(null);
const rating = z.number().min(0).max(5).nullish().catch(null);
const listingRow = z.object({
  placeId: text, title: text, address: text, city: text, countryCode: text,
  website: text, url: text, phone: text, phoneUnformatted: text, totalScore: rating, reviewsCount: count,
  openingHours: z.array(z.object({ day: z.string(), hours: z.string() })).nullish().catch(null),
});

export function mapApifyListing(value: unknown): Listing | null {
  const result = listingRow.safeParse(value);
  if (!result.success || !result.data.title) return null;
  const row = result.data;
  return {
    source: 'apify', placeId: row.placeId ?? null, name: row.title ?? null, address: row.address ?? null,
    city: row.city ?? null, countryCode: row.countryCode ?? null, website: row.website ?? null,
    mapsUrl: row.url ?? null, phone: row.phoneUnformatted ?? row.phone ?? null,
    rating: row.totalScore ?? null, reviewCount: row.reviewsCount ?? null,
    openingPeriods: row.openingHours ? mapApifyHours(row.openingHours) : null,
  };
}

const reviewRow = z.object({ stars: z.number().int().min(1).max(5), responseFromOwnerText: text,
  responseFromOwnerDate: text, publishedAtDate: text });

export function mapApifyReview(value: unknown): Review | null {
  const result = reviewRow.safeParse(value);
  if (!result.success) return null;
  const review = result.data;
  const published = review.publishedAtDate ? new Date(review.publishedAtDate) : null;
  return {
    stars: review.stars,
    responded: Boolean(review.responseFromOwnerText || review.responseFromOwnerDate),
    publishedAt: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
  };
}

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>) {
  const existing = cache.get(key);
  if (existing) return existing;
  if (cache.size >= 250) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const pending = load().catch(error => {
    if (cache.get(key) === pending) cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}

const listingQueries = new Map<string, Promise<Listing | null>>();
const listingIds = new Map<string, Listing>();
const reviewCache = new Map<string, Promise<Review[]>>();

export async function apifyListing(query: ListingQuery, env: ApifyEnv, run = runApifyActor) {
  const token = env.APIFY_TOKEN;
  if (!token || (!query.mapsUrl && !query.text)) return null;
  const actor = env.APIFY_PLACES_ACTOR;
  const directId = query.mapsUrl ? new URL(query.mapsUrl).searchParams.get('query_place_id') : null;
  const idKey = (placeId: string) => JSON.stringify([actor, placeId]);
  if (directId && listingIds.has(idKey(directId))) return listingIds.get(idKey(directId)) ?? null;
  return cached(listingQueries, JSON.stringify([actor, query]), async () => {
    const input = query.mapsUrl ? { startUrls: [{ url: query.mapsUrl }] } : { searchStringsArray: [query.text] };
    const rows = z.array(z.unknown()).parse(await run(actor, { ...input, maxCrawledPlacesPerSearch: 1 }, token));
    const listing = rows.map(mapApifyListing).find(Boolean) ?? null;
    if (listing?.placeId) {
      const oldest = listingIds.keys().next().value;
      if (listingIds.size >= 250 && oldest !== undefined) listingIds.delete(oldest);
      listingIds.set(idKey(listing.placeId), listing);
    }
    return listing;
  });
}

export async function apifyReviews(listing: Listing, env: ApifyEnv, run = runApifyActor) {
  const token = env.APIFY_TOKEN;
  if (!token || !listing.placeId) return [];
  const actor = env.APIFY_REVIEWS_ACTOR;
  const mapsUrl = new URL('https://www.google.com/maps/search/');
  mapsUrl.searchParams.set('api', '1');
  mapsUrl.searchParams.set('query', listing.name ?? listing.placeId);
  mapsUrl.searchParams.set('query_place_id', listing.placeId);
  return cached(reviewCache, JSON.stringify([actor, listing.placeId]), async () => {
    const rows = z.array(z.unknown()).parse(await run(actor, {
      startUrls: [{ url: mapsUrl.href }], maxReviews: 30, reviewsSort: 'newest',
    }, token));
    return rows.slice(0, 30).map(mapApifyReview).filter((item): item is Review => item !== null);
  });
}
