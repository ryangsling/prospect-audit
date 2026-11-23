export type CheckResult = {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'partial' | 'not_checked';
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
  details?: Record<string, unknown>;
};
