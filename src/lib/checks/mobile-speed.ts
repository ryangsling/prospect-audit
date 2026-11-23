import type { SpeedMetrics } from '../clients/pagespeed';
import type { CheckResult } from './types';

export function detectMobileSpeed(metrics: SpeedMetrics | null, reason: string): CheckResult {
  const base = { id: 'mobile_speed', label: 'Mobile speed' };
  if (!metrics) return { ...base, status: 'not_checked', confidence: 'low', evidence: reason };
  return {
    ...base, status: metrics.score >= 70 ? 'pass' : metrics.score >= 50 ? 'partial' : 'fail',
    confidence: 'high',
    evidence: `Mobile score ${metrics.score}/100.${metrics.lcpMs === null ? '' : ` Main content appeared after about ${(metrics.lcpMs / 1000).toFixed(1)}s.`}`,
    details: { ...metrics },
  };
}
