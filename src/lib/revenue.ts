import { z } from 'zod';
import { currency, type Country } from '../config/currency';
import { nichePresets, type Niche } from '../config/niches';
import type { CheckResult } from './checks/types';

const rate = z.number().min(0).max(1);
export const assumptionsSchema = z.object({
  inquiriesPerMonth: z.number().min(0).max(1_000_000),
  afterHoursShare: rate,
  afterHoursCapture: rate,
  closeRate: rate,
  averageTicket: z.number().min(0).max(10_000_000),
  speedLossRate: rate,
  bookingDropRate: rate,
});
export type Assumptions = z.infer<typeof assumptionsSchema>;

export function defaultAssumptions(niche: Niche, country: Country, reviews: number | null, checks: CheckResult[]): Assumptions {
  const preset = nichePresets[niche];
  const size = reviews === null ? 1 : Math.min(2, Math.max(0.5, reviews / preset.medianReviews));
  const hasChannel = checks.some(check => ['chatbot', 'booking'].includes(check.id) && check.status === 'pass');
  return {
    inquiriesPerMonth: Math.round(preset.inquiriesPerMonth * size),
    afterHoursShare: preset.afterHoursShare,
    afterHoursCapture: hasChannel ? 0.8 : 0,
    closeRate: preset.closeRate,
    averageTicket: preset.ticketUsd * currency[country].perUsd,
    speedLossRate: preset.speedLossRate,
    bookingDropRate: preset.bookingDropRate,
  };
}

function roundEstimate(amount: number) {
  const step = amount > 10_000 ? 500 : 50;
  return Math.round(amount / step) * step;
}

export function estimateRevenue(assumptions: Assumptions, checks: CheckResult[], country: Country) {
  const status = (id: string) => checks.find(check => check.id === id)?.status ?? 'not_checked';
  const booking = status('booking');
  const chat = status('chatbot');
  const canEstimateCapture = booking === 'pass' || chat === 'pass'
    || (booking !== 'not_checked' && chat !== 'not_checked');

  const alwaysOpen = checks.some(check => check.id === 'after_hours' && check.details?.weeklyClosedHours === 0);
  const value = assumptions.inquiriesPerMonth * assumptions.closeRate * assumptions.averageTicket;
  const components = {
    afterHours: alwaysOpen ? 0 : canEstimateCapture
      ? value * assumptions.afterHoursShare * (1 - assumptions.afterHoursCapture) : null,
    slowSite: status('mobile_speed') === 'fail' ? value * assumptions.speedLossRate : null,
    noBooking: booking === 'fail' ? value * assumptions.bookingDropRate : null,
  };
  const measured = Object.values(components).filter(amount => amount !== null);
  const total = measured.reduce((sum, amount) => sum + amount, 0);
  return {
    assumptions, currency: currency[country].code, components,
    range: measured.length ? { low: roundEstimate(total * 0.6), high: roundEstimate(total * 1.2) } : null,
  };
}
