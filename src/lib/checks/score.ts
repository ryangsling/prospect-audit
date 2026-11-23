import type { CheckResult } from './types';

const weights = {
  booking: 25, chatbot: 20, after_hours: 20, mobile_speed: 15, reviews: 15, hygiene: 5,
};

export function checkWeight(id: string) {
  return weights[id as keyof typeof weights] ?? 0;
}

export function scoreChecks(checks: CheckResult[]) {
  let available = 0;
  let earned = 0;
  for (const check of checks) {
    if (check.status === 'not_checked') continue;
    const weight = checkWeight(check.id);
    available += weight;
    earned += weight * (check.status === 'pass' ? 1 : check.status === 'partial' ? 0.5 : 0);
  }
  if (!available) return null;
  const value = Math.round(100 * earned / available);
  const grade = value >= 80 ? 'Strong' : value >= 60 ? 'Needs work' : 'Losing customers';
  return { value, grade, checkedWeight: available };
}
