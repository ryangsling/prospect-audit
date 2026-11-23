'use client';

import { useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ChevronDown, Globe2, ScanLine } from 'lucide-react';
import { countries, countryNames, currency, type Country } from '../config/currency';
import { niches } from '../config/niches';
import type { AuditResult } from '../lib/audit';
import AssumptionFields, { assumptionOverrides, type AssumptionEdits } from './components/assumption-fields';
import AuditProgress from './components/audit-progress';
import AuditResults from './components/audit-result';

const nicheNames = {
  salon: 'Salon', barber: 'Barber', spa: 'Spa', roofing: 'Roofing',
  epoxy_flooring: 'Epoxy flooring', dentist: 'Dentist', other: 'Other',
};

export default function AuditWorkspace() {
  const form = useRef<HTMLFormElement>(null);
  const preview = useRef<HTMLElement>(null);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [edits, setEdits] = useState<AssumptionEdits>({});
  const [country, setCountry] = useState<Country>('US');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function clearAudit() {
    form.current?.reset();
    setCountry('US');
    setEdits({});
    setError('');
    setResult(null);
    form.current?.querySelector<HTMLInputElement>('[name="websiteUrl"]')?.focus();
  }

  function showError(message: string) {
    setError(message);
    if (matchMedia('(max-width: 700px)').matches) {
      form.current?.querySelector('button[type=submit]')?.scrollIntoView({ block: 'center' });
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = Object.fromEntries(Array.from(data, ([key, value]) => [key, String(value).trim()]).filter(([, value]) => value));
    setError('');
    setResult(null);
    setLoading(true);
    if (matchMedia('(max-width: 700px)').matches) preview.current?.scrollIntoView({ block: 'start' });
    try {
      const response = await fetch('/api/audit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, assumptions: assumptionOverrides(edits) }),
      });
      if (response.status === 400) {
        const reason = await response.json().catch(() => null);
        showError(reason?.issues?.[0]?.message ?? 'Check the business details and try again.');
        return;
      }
      if (!response.ok) {
        showError(response.status === 401 ? 'Your session expired. Sign in again to run an audit.' : 'The audit could not be completed. Try again in a moment.');
        return;
      }
      setResult(await response.json() as AuditResult);
    } catch {
      showError('Could not reach the audit service. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header className="page-heading">
        <h1>New audit<span>.</span></h1>
        <p>Find out how easily customers can discover, contact, and book with a business.</p>
      </header>
      <div className={`workspace${result ? ' has-result' : ''}`}>
        <section className="panel form-panel" aria-label="Audit inputs">
          <form ref={form} onSubmit={submit}>
            <fieldset className="form-section">
              <legend><span className="section-index">/01</span> Business</legend>
              <label className="field">Website URL
                <span className="input-icon"><Globe2 size={16} /><input name="websiteUrl" type="url" placeholder="https://example.com" maxLength={2048} /></span>
              </label>
              <label className="field">Google Maps URL <input name="mapsUrl" type="url" placeholder="https://maps.app.goo.gl/…" maxLength={2048} /></label>
              <p className="hint form-divider">Or enter a name and city</p>
              <div className="pair">
                <label className="field">Business name <input name="businessName" maxLength={160} placeholder="Willow Salon" /></label>
                <label className="field">City <input name="city" maxLength={120} placeholder="Bristol" /></label>
              </div>
            </fieldset>

            <fieldset className="form-section market">
              <legend><span className="section-index">/02</span> Market</legend>
              <fieldset className="segments"><legend>Niche</legend>
                <div>{niches.map(niche => <label key={niche}>
                  <input type="radio" name="niche" value={niche} defaultChecked={niche === 'other'} /><span>{nicheNames[niche]}</span>
                </label>)}</div>
              </fieldset>
              <fieldset className="segments"><legend>Country</legend>
                <div>{countries.map(item => <label key={item}>
                  <input type="radio" name="country" value={item} checked={country === item} onChange={() => setCountry(item)} />
                  <span>{item}</span><span className="sr-only"> {countryNames[item]}</span>
                </label>)}</div>
              </fieldset>
              <label className="field">Contact first name <span className="optional">(optional)</span><input name="firstName" maxLength={80} placeholder="Riley" /></label>
            </fieldset>

            <details className="disclosure pre-assumptions">
              <summary><span><span className="section-index">/03</span> Assumptions <span className="optional">(optional)</span></span>
                <ChevronDown size={16} className="disclosure-icon" /></summary>
              <AssumptionFields edits={edits} onChange={(key, value) => setEdits(current => ({ ...current, [key]: value }))} currency={currency[country].code} />
            </details>
            <button className="primary run-button" type="submit" disabled={loading}>
              {loading ? 'Running audit…' : 'Run audit'} <ArrowRight size={17} />
            </button>
            {error && <p className="error form-error" role="alert">{error}</p>}
          </form>
        </section>

        <section className="panel preview" ref={preview} aria-labelledby="results-heading" aria-busy={loading}>
          <div className="preview-header">
            {result ? <span className="eyebrow">Audit results</span> : <h2 id="results-heading">Audit preview</h2>}
            <span className={`tag ${loading || result ? 'active' : ''}`}>{loading ? 'Running' : result ? 'Complete' : 'Ready'}</span>
          </div>
          {loading ? <AuditProgress /> : result ? <AuditResults key={result.auditedAt} result={result} onReset={clearAudit} /> : (
            <div className="empty-audit">
              <div className="preview-art" aria-hidden="true">
                <div className="art-frame"><div className="art-browser"><i /><i /><i /></div><div className="art-line" /><div className="art-line" /><div className="art-line" /></div>
                <div className="art-scan"><ScanLine size={30} strokeWidth={1.55} /></div>
              </div>
              <h3>Your audit starts here.</h3>
              <p>Run a scan to see the business’s presence score, revenue estimate, and priority fixes.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
