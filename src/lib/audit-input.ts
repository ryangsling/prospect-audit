import { z } from 'zod';
import { countries } from '../config/currency';
import { niches } from '../config/niches';
import { isGoogleMaps, isWebsiteUrl } from './clients/public-url';
import { assumptionsSchema } from './revenue';

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();
function urlInput(validate: (url: URL) => boolean, message: string) {
  return z.string().trim().max(2048).refine(value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && validate(url);
    } catch {
      return false;
    }
  }, message).optional();
}

export const auditInputSchema = z.object({
  websiteUrl: urlInput(isWebsiteUrl, 'Enter a public business website URL.'),
  mapsUrl: urlInput(url => !url.username && !url.password && !url.port && isGoogleMaps(url),
    'Enter a Google Maps listing URL.'),
  businessName: optionalText(160),
  city: optionalText(120),
  niche: z.enum(niches).default('other'),
  country: z.enum(countries).default('US'),
  firstName: optionalText(80),
  assumptions: assumptionsSchema.partial().optional(),
}).refine(input => input.websiteUrl || input.mapsUrl || (input.businessName && input.city), {
  path: ['websiteUrl'],
  message: 'Enter a website, a Google Maps listing, or a business name and city.',
});

export type AuditInput = z.output<typeof auditInputSchema>;
