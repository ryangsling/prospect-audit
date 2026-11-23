'use client';

import { useEffect, useState } from 'react';
import { Building2, CircleCheck, Globe2, MessagesSquare, Timer, Minus } from 'lucide-react';
import type { AuditResult } from '../../lib/audit';

const stages = [
  ['Listing', Building2], ['Website', Globe2], ['Mobile speed', Timer], ['Reviews', MessagesSquare],
] as const;

function hasResult(result: AuditResult, stage: typeof stages[number][0]) {
  if (stage === 'Listing') return Boolean(result.business.listingSource);
  if (stage === 'Website') return result.scan.pagesChecked.length > 0;
  const id = stage === 'Reviews' ? 'reviews' : 'mobile_speed';
  return result.checks.some(check => check.id === id && check.status !== 'not_checked');
}

export default function AuditProgress({ result }: { result?: AuditResult }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (result) return;
    const start = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [result]);

  return (
    <div className="audit-progress">
      {!result && <div className="progress-header">
        <div><h3>Scan in progress</h3><p className="hint">Results arrive together when the scan is ready.</p></div>
        <span className="tag active"><span className="signal" />{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
      </div>}
      <ul className="stage-list">
        {stages.map(([label, Icon]) => {
          const checked = result && hasResult(result, label);
          return <li key={label}>
            <Icon size={17} className="stage-icon" aria-hidden="true" />
            <span>{label}</span>
            <span className="stage-state">
              {result ? checked ? <><CircleCheck size={15} /> Checked</> : <><Minus size={15} /> Unavailable</> : 'Awaiting result'}
            </span>
          </li>;
        })}
      </ul>
    </div>
  );
}
