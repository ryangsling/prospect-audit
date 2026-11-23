import type { Listing, Review } from '../clients/listing';
import type { CheckResult } from './types';

export function detectReviews(listing: Listing | null, reviews: Review[] | null, reason: string): CheckResult {
  const base = { id: 'reviews', label: 'Google review responses' };
  const details = { rating: listing?.rating ?? null, reviewCount: listing?.reviewCount ?? null };
  if (reviews === null) return { ...base, details, status: 'not_checked', confidence: 'low', evidence: reason };
  if (reviews.length < 5) {
    return { ...base, details: { ...details, sampleSize: reviews.length }, status: 'not_checked', confidence: 'low', evidence: 'Too few reviews to judge' };
  }
  const negative = reviews.filter(review => review.stars <= 3);
  const fraction = (sample: Review[]) => sample.filter(review => review.responded).length / sample.length;
  const rate = fraction(reviews);
  const percentage = (value: number) => Math.round(value * 1000) / 10;
  const newestUnansweredNegative = negative
    .filter(review => !review.responded && review.publishedAt)
    .map(review => review.publishedAt as string).sort().at(-1) ?? null;

  return {
    ...base,
    status: rate >= 0.7 ? 'pass' : rate >= 0.3 ? 'partial' : 'fail',
    confidence: reviews.length >= 15 ? 'high' : 'medium',
    evidence: `Owner replied to ${percentage(rate)}% of the ${reviews.length} recent reviews sampled.`,
    details: {
      ...details, sampleSize: reviews.length, responseRate: percentage(rate),
      negativeResponseRate: negative.length ? percentage(fraction(negative)) : null,
      newestUnansweredNegative,
    },
  };
}
