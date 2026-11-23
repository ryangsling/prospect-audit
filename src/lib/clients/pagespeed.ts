import { z } from 'zod';
import { requestJson } from './json-http';

const audit = z.object({ numericValue: z.number().nonnegative().optional() });
const lighthouse = z.object({
  lighthouseResult: z.object({
    categories: z.object({ performance: z.object({ score: z.number().min(0).max(1) }) }),
    audits: z.record(z.string(), audit).optional(),
  }),
  loadingExperience: z.object({
    metrics: z.object({
      INTERACTION_TO_NEXT_PAINT: z.object({ percentile: z.number().nonnegative() }).optional(),
    }).optional(),
  }).optional(),
});

export type SpeedMetrics = { score: number; lcpMs: number | null; cls: number | null; inpMs: number | null; tbtMs: number | null };

export async function mobileSpeed(website: URL, key: string, signal?: AbortSignal): Promise<SpeedMetrics> {
  const url = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
  url.search = new URLSearchParams({ url: website.href, strategy: 'mobile', category: 'performance', key }).toString();
  const data = lighthouse.parse(await requestJson(url, 45_000, { signal }));
  const { categories, audits } = data.lighthouseResult;
  return {
    score: Math.round(categories.performance.score * 100),
    lcpMs: audits?.['largest-contentful-paint']?.numericValue ?? null,
    cls: audits?.['cumulative-layout-shift']?.numericValue ?? null,
    inpMs: data.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
    tbtMs: audits?.['total-blocking-time']?.numericValue ?? null,
  };
}
