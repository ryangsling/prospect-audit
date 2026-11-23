import { z } from 'zod';
import { countries } from '../../config/currency';
import { assumptionsSchema } from '../revenue';

const checkIds = ['booking', 'chatbot', 'mobile_speed', 'after_hours', 'reviews', 'hygiene'] as const;
const check = z.object({
  id: z.enum(checkIds),
  label: z.string().max(80),
  status: z.enum(['pass', 'partial', 'fail', 'not_checked']),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.string().max(512),
  details: z.record(z.string(), z.unknown()).optional(),
});
const optionalText = z.string().max(2048).nullable();

export const pdfInputSchema = z.object({
  business: z.object({
    name: optionalText,
    websiteTitle: optionalText,
    websiteUrl: optionalText,
    address: optionalText,
    firstName: optionalText,
    country: z.enum(countries),
  }),
  checks: z.array(check).length(checkIds.length)
    .refine(checks => new Set(checks.map(check => check.id)).size === checkIds.length, 'Checks must appear once each.'),
  revenue: z.object({ assumptions: assumptionsSchema }),
  auditedAt: z.iso.datetime(),
});

export type PdfInput = z.infer<typeof pdfInputSchema>;
