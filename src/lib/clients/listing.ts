export type OpeningPeriod = { start: number; end: number };
export type Listing = {
  source: 'apify' | 'places';
  placeId: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  countryCode: string | null;
  website: string | null;
  mapsUrl: string | null;
  phone: string | null;
  rating: number | null;
  reviewCount: number | null;
  openingPeriods: OpeningPeriod[] | null;
};
export type Review = { stars: number; responded: boolean; publishedAt: string | null };
export type ListingQuery = { mapsUrl?: string; text?: string; country?: string };

const week = 7 * 24 * 60;
export function weeklyClosedHours(periods: OpeningPeriod[]) {
  const sorted = periods.flatMap(({ start, end }) =>
    end > week ? [{ start, end: week }, { start: 0, end: end - week }] : [{ start, end }])
    .sort((a, b) => a.start - b.start);
  let till = 0;
  let open = 0;
  for (const { start, end } of sorted) {
    if (end <= till) continue;
    open += end - Math.max(start, till);
    till = end;
  }
  return (week - open) / 60;
}
