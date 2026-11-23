import { z } from 'zod';
import { requestJson } from './json-http';
import type { Listing, ListingQuery, OpeningPeriod } from './listing';

const timePoint = z.object({ day: z.number().int().min(0).max(6), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) });
const hoursSchema = z.array(z.object({ open: timePoint, close: timePoint.optional() }));
const placeSchema = z.object({
  id: z.string().optional(),
  displayName: z.object({ text: z.string() }),
  formattedAddress: z.string().optional(),
  addressComponents: z.array(z.object({ longText: z.string(), shortText: z.string(), types: z.array(z.string()) })).optional(),
  websiteUri: z.string().optional(),
  googleMapsUri: z.string().optional(),
  internationalPhoneNumber: z.string().optional(),
  nationalPhoneNumber: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  userRatingCount: z.number().int().nonnegative().optional(),
  regularOpeningHours: z.object({ periods: hoursSchema }).optional().catch(undefined),
});

function openingPeriods(periods: z.infer<typeof hoursSchema>): OpeningPeriod[] | null {
  if (periods.length === 1 && !periods[0].close
    && Object.values(periods[0].open).every(value => value === 0)) return [{ start: 0, end: 10080 }];
  const minuteOfWeek = (point: z.infer<typeof timePoint>) => (point.day * 24 + point.hour) * 60 + point.minute;
  const result: OpeningPeriod[] = [];
  for (const period of periods) {
    if (!period.close) return null;
    const start = minuteOfWeek(period.open);
    const end = minuteOfWeek(period.close);
    if (start === end) return null;
    result.push({ start, end: end < start ? end + 10080 : end });
  }
  return result;
}

function mapPlace(value: unknown): Listing | null {
  const result = placeSchema.safeParse(value);
  if (!result.success || !result.data.displayName.text.trim()) return null;
  const place = result.data;
  const component = (type: string) => place.addressComponents?.find(part => part.types.includes(type));
  return {
    source: 'places', placeId: place.id ?? null, name: place.displayName.text, address: place.formattedAddress ?? null,
    city: component('locality')?.longText ?? component('postal_town')?.longText ?? null,
    countryCode: component('country')?.shortText ?? null, website: place.websiteUri ?? null,
    mapsUrl: place.googleMapsUri ?? null, phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null,
    rating: place.rating ?? null, reviewCount: place.userRatingCount ?? null,
    openingPeriods: place.regularOpeningHours ? openingPeriods(place.regularOpeningHours.periods) : null,
  };
}

export function mapsSearchText(url: URL) {
  const query = url.searchParams.get('query') ?? url.searchParams.get('q');
  if (query && /\p{L}/u.test(query) && !/^place_id:/i.test(query)) return query;
  const slug = url.pathname.match(/\/maps\/place\/([^/]+)/i)?.[1];
  if (!slug) return undefined;
  try {
    const decoded = decodeURIComponent(slug).replace(/\+/g, ' ');
    return /\p{L}/u.test(decoded) ? decoded : undefined;
  } catch {
    return undefined;
  }
}

const fields = [
  'id', 'displayName', 'formattedAddress', 'addressComponents', 'websiteUri', 'googleMapsUri',
  'internationalPhoneNumber', 'nationalPhoneNumber', 'rating', 'userRatingCount', 'regularOpeningHours',
];

export async function placesListing(query: ListingQuery, key: string | undefined, signal?: AbortSignal) {
  if (!key) return null;
  const maps = query.mapsUrl ? new URL(query.mapsUrl) : null;
  const id = maps?.searchParams.get('query_place_id') ?? maps?.searchParams.get('q')?.match(/^place_id:(.+)$/)?.[1];
  const headers = { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key };
  if (id && /^[\w-]{1,250}$/.test(id)) {
    const url = new URL(`https://places.googleapis.com/v1/places/${id}`);
    return mapPlace(await requestJson(url, 15_000, {
      headers: { ...headers, 'X-Goog-FieldMask': fields.join(',') }, signal,
    }));
  }
  const textQuery = (maps && mapsSearchText(maps)) || query.text;
  if (!textQuery) return null;
  const response = await requestJson(new URL('https://places.googleapis.com/v1/places:searchText'), 15_000, {
    method: 'POST', signal,
    headers: { ...headers, 'X-Goog-FieldMask': fields.map(field => 'places.' + field).join(',') },
    body: JSON.stringify({ textQuery, pageSize: 1, regionCode: query.country }),
  });
  const rows = z.object({ places: z.array(z.unknown()).optional() }).parse(response);
  return mapPlace(rows.places?.[0]);
}
