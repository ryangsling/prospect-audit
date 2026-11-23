'use client';

import { useEffect, useState } from 'react';
import { ArrowDownToLine, Check, ChevronDown, Copy, Minus, Plus, X } from 'lucide-react';
import { formatMoney } from '../../config/currency';
import type { AuditResult } from '../../lib/audit';
import type { CheckResult } from '../../lib/checks/types';
import { outreachHook } from '../../lib/outreach';
import { estimateRevenue, type Assumptions } from '../../lib/revenue';
import { downloadResponse } from '../download';
import AssumptionFields, { assumptionOverrides, type AssumptionEdits } from './assumption-fields';
import AuditProgress from './audit-progress';

const statuses = {
  pass: { Icon: Check, label: 'Pass' },
  partial: { Icon: Minus, label: 'Partial' },
  fail: { Icon: X, label: 'Fail' },
  not_checked: { Icon: Minus, label: 'Not checked' },
};

function CountUp({ value }: { value: number }) {
  const [count, setCount] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches ? value : 0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const start = performance.now();
    function tick(now: number) {
      const progress = Math.min(1, (now - start) / 220);
      setCount(Math.round(value * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <strong aria-label={`${value} out of 100`}>{count}<small aria-hidden="true"> / 100</small></strong>;
}

function detailLabel(key: string) {
  const names: Record<string, string> = {
    lcpMs: 'Largest contentful paint (ms)', tbtMs: 'Total blocking time (ms)', inpMs: 'Interaction to next paint (ms)',
    cls: 'Cumulative layout shift', https: 'HTTPS', responseRate: 'Response rate (%)', negativeResponseRate: 'Negative response rate (%)',
  };
  if (Object.hasOwn(names, key)) return names[key];
  const human = key.replace(/([A-Z])/g, ' $1').toLowerCase();
  return human.charAt(0).toUpperCase() + human.slice(1);
}

function checkRow(check: CheckResult) {
  const { Icon, label } = statuses[check.status];
  const details = Object.entries(check.details ?? {}).filter(([, value]) => value === null || ['boolean', 'string', 'number'].includes(typeof value));
  return (
    <li key={check.id} className="check-row">
      <details>
        <summary className="check-summary">
          <span className={`check-icon ${check.status}`} aria-label={label} role="img"><Icon size={16} aria-hidden="true" /></span>
          <span className="check-text"><strong>{check.label}</strong><span>{check.evidence}</span></span>
          <span className="tag confidence" title={`${check.confidence} confidence`}>{check.confidence}</span>
          <ChevronDown className="disclosure-icon" size={15} aria-hidden="true" />
        </summary>
        <div className="check-details">
          <dl><dt>Status</dt><dd>{label}</dd><dt>Confidence</dt><dd>{check.confidence}</dd>
            {details.map(([key, value]) => <div className="detail-pair" key={key}>
              <dt>{detailLabel(key)}</dt>
              <dd>{value === true ? 'Yes' : value === false ? 'No' : value === null ? 'Unavailable' : String(value)}</dd>
            </div>)}
          </dl>
        </div>
      </details>
    </li>
  );
}

export default function AuditResults({ result, onReset }: { result: AuditResult; onReset: () => void }) {
  const [edits, setEdits] = useState<AssumptionEdits>({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const business = result.business;
  const estimate = estimateRevenue({ ...result.revenue.assumptions, ...assumptionOverrides(edits) }, result.checks, business.country);
  const hook = outreachHook(result.checks, business.firstName);
  const score = result.score;
  const checked = result.checks.filter(check => check.status !== 'not_checked').length;
  const grade = score?.grade === 'Strong' ? 'pass' : score?.grade === 'Needs work' ? 'partial' : 'fail';
  const money = (amount: number) => formatMoney(amount, business.country);
  const title = business.name ?? business.websiteTitle ?? business.websiteUrl ?? 'Business audit';

  function edit(key: keyof Assumptions, value: string) {
    setEdits(current => ({ ...current, [key]: value }));
  }

  async function downloadPdf() {
    setExporting(true);
    setExportError('');
    try {
      const response = await fetch('/api/audit/pdf', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...result, revenue: estimate }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? 'Sign in again to download your PDF.' : 'The PDF could not be generated. Try again.');
      await downloadResponse(response, 'audit.pdf');
    } catch (cause) {
      setExportError(cause instanceof Error && cause.name === 'Error' ? cause.message : 'Download failed. Try again.');
    } finally {
      setExporting(false);
    }
  }

  async function copy() {
    if (!hook) return;
    try {
      await navigator.clipboard.writeText(hook);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  return (
    <>
      <div className="result-heading">
        <h2 id="results-heading">{title}</h2>
        {business.address && <p className="hint">{business.address}</p>}
      </div>
      <div className="metric-grid">
        <section className="metric score-card" aria-label="Online presence score">
          <p className="eyebrow">Presence score</p>
          <div className="score-value">{score ? <CountUp key={score.value} value={score.value} /> : <strong aria-label="Unavailable">–</strong>}</div>
          <p className="metric-caption">{score ? <span className={`tag ${grade}`}>{score.grade}</span> : 'Insufficient evidence'}</p>
          {score && <p className="metric-caption score-coverage">{checked} of {result.checks.length} checks scored</p>}
        </section>
        <section className="metric revenue-card" aria-label="Revenue at risk">
          <p className="eyebrow">Revenue at risk <span className="tag active">Estimated</span></p>
          <p className="revenue-value">
            {estimate.range ? <strong key={`${estimate.range.low}-${estimate.range.high}`} className="roll">
              {money(estimate.range.low)} <span>to</span> {money(estimate.range.high)}
            </strong> : <strong aria-label="Unavailable">–</strong>}
          </p>
          <p className="metric-caption hint">{estimate.range ? 'Potential loss per month' : 'Insufficient evidence'}</p>
        </section>
      </div>
      <details className="disclosure result-assumptions">
        <summary>Assumptions <ChevronDown size={16} className="disclosure-icon" /></summary>
        <AssumptionFields edits={edits} onChange={edit} defaults={result.revenue.assumptions} currency={estimate.currency} />
      </details>

      <section className="report-section" aria-labelledby="checks-heading">
        <div className="section-title"><h3 id="checks-heading">Checks</h3><span className="section-meta">{result.checks.length}</span></div>
        <ul className="checks">{result.checks.map(checkRow)}</ul>
        <details className="disclosure scan-notes">
          <summary>Scan coverage <ChevronDown size={16} className="disclosure-icon" /></summary>
          <AuditProgress result={result} />
          {result.scan.listingIssue && <p className="hint">{result.scan.listingIssue}</p>}
          {result.scan.failures.map(({ url, reason }, index) => <p className="hint" key={`${index}-${url}`}>{reason} {url}</p>)}
        </details>
      </section>

      {result.fixes.length > 0 && <section className="report-section" aria-labelledby="fixes-heading">
        <div className="section-title"><h3 id="fixes-heading">Top fixes</h3></div>
        <ol className="fix-list">{result.fixes.map((fix, index) => <li key={fix}>
          <span className="section-index">/0{index + 1}</span><p>{fix}</p>
        </li>)}</ol>
      </section>}

      {hook && <section className="report-section" aria-labelledby="outreach-heading">
        <div className="section-title"><h3 id="outreach-heading">Outreach hook</h3></div>
        <div className="hook-card">
          <textarea aria-label="Outreach hook" value={hook} readOnly rows={3} />
          <button className="secondary" type="button" onClick={copy}>
            {copyState === 'copied' ? <Check size={15} /> : <Copy size={15} />}
            <span aria-live="polite">{copyState === 'copied' ? 'Copied' : 'Copy'}</span>
          </button>
          {copyState === 'failed' && <p className="hint" role="status">Select the text to copy it.</p>}
        </div>
      </section>}

      <div className="actions sticky-actions">
        {exportError && <p role="alert" className="error">{exportError}</p>}
        <button className="primary" type="button" onClick={downloadPdf} disabled={exporting}>
          <ArrowDownToLine size={16} />{exporting ? 'Generating…' : 'Download PDF'}
        </button>
        <button className="secondary" type="button" onClick={onReset}><Plus size={16} />New audit</button>
      </div>
    </>
  );
}
