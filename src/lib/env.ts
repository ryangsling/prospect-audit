import { z } from 'zod';

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(value => typeof value === 'string' && value.trim() === '' ? undefined : value, schema.optional());

const schema = z.object({
  APIFY_TOKEN: optional(z.string()),
  APIFY_PLACES_ACTOR: optional(z.string().trim().min(1)),
  APIFY_REVIEWS_ACTOR: optional(z.string().trim().min(1)),
  GOOGLE_PLACES_API_KEY: optional(z.string()),
  PAGESPEED_API_KEY: optional(z.string()),
  APP_PASSWORD: optional(z.string()),
  AGENCY_NAME: optional(z.string().trim().min(1)),
  AGENCY_URL: optional(z.url({ protocol: /^https?$/ })),
  AGENCY_WHATSAPP: optional(z.string().regex(/^\d+$/)),
  AGENCY_EMAIL: optional(z.email()),
});

export function readEnv(source: Record<string, string | undefined> = process.env) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map(issue => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration for ${fields}.`);
  }
  return {
    ...result.data,
    APIFY_PLACES_ACTOR: result.data.APIFY_PLACES_ACTOR ?? 'compass~crawler-google-places',
    APIFY_REVIEWS_ACTOR: result.data.APIFY_REVIEWS_ACTOR ?? 'compass~Google-Maps-Reviews-Scraper',
    AGENCY_NAME: result.data.AGENCY_NAME ?? 'Incodet',
    AGENCY_URL: result.data.AGENCY_URL ?? 'https://incodet.com',
  };
}
