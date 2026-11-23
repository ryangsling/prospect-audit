'use client';

import { useRef, useState, type DragEvent } from 'react';
import { ArrowDownToLine, ArrowRight, Check, Copy, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { parse } from 'csv-parse/browser/esm/sync';
import { strFromU8, unzipSync } from 'fflate';
import { countries, formatMoney, type Country } from '../config/currency';
import { attachmentName, saveDownload } from './download';

type Lead = { business: string; country: Country };
type ResultRow = {
  business: string; score: string; revenue_low: string; revenue_high: string; top_issue: string; hook: string;
};

function rowsFromCsv<T>(text: string): T[] {
  return parse(text, {
    bom: true, skip_empty_lines: true, trim: true,
    columns: (headers: string[]) => headers.map(value => value.trim().toLowerCase()),
  }) as T[];
}

function getLeads(csv: string) {
  return rowsFromCsv<Partial<Record<'name' | 'website' | 'maps_url' | 'country', string>>>(csv)
    .map((row, index): Lead => ({
      business: row.name || row.website || row.maps_url || `Lead ${index + 1}`,
      country: countries.find(country => country === row.country?.toUpperCase()) ?? 'US',
    }));
}

function readResults(bytes: ArrayBuffer) {
  const archive = unzipSync(new Uint8Array(bytes), { filter: entry => entry.name === 'results.csv' });
  if (!archive['results.csv']) throw new Error('Missing results.csv');
  return rowsFromCsv<ResultRow>(strFromU8(archive['results.csv']));
}

function failed(row: ResultRow) {
  return Boolean(row.top_issue && !row.score && !row.revenue_low && !row.revenue_high && !row.hook);
}

export default function BatchUpload({ sampleHref }: { sampleHref: string }) {
  const picker = useRef<HTMLInputElement>(null);
  const selection = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [archive, setArchive] = useState<{ blob: Blob; name: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<number | null>(null);
  const [copyError, setCopyError] = useState(false);

  async function choose(candidate: File | undefined) {
    if (!candidate || loading) return;
    const token = ++selection.current;
    setFile(null);
    setLeads([]);
    setResults(null);
    setArchive(null);
    setError('');
    setCopied(null);
    setCopyError(false);

    if (candidate.size > 128 * 1024) {
      setError('Choose a CSV that is 128 KiB or smaller.');
      return;
    }
    try {
      const csv = new TextDecoder('utf-8', { fatal: true }).decode(await candidate.arrayBuffer());
      const preview = getLeads(csv);
      if (token !== selection.current) return;
      if (!preview.length || preview.length > 100) {
        setError('Choose a CSV containing 1 to 100 leads.');
        return;
      }
      setFile(candidate);
      setLeads(preview);
    } catch {
      if (token === selection.current) setError('Could not read this CSV. Check the encoding, quoting, and columns.');
    }
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void choose(event.dataTransfer.files[0]);
  }

  async function run() {
    if (!file || loading) return;
    setLoading(true);
    setError('');
    setCopied(null);
    setCopyError(false);
    setResults(null);
    setArchive(null);
    const body = new FormData();
    body.append('file', file);
    try {
      const response = await fetch('/api/audit/batch', { method: 'POST', body });
      if (!response.ok) {
        const issue = response.status === 400 ? await response.json().catch(() => null) : null;
        setError(response.status === 401 ? 'Sign in again to run a batch.' : issue?.error ?? 'The batch could not be completed. Try again.');
        return;
      }
      const blob = await response.blob();
      setArchive({ blob, name: attachmentName(response, 'audit-batch.zip') });
      const summary = readResults(await blob.arrayBuffer());
      if (summary.length !== leads.length) throw new Error('Unexpected output row count');
      setResults(summary);
    } catch {
      setError('Could not load the batch results. Try again, or download the ZIP if it is available.');
    } finally {
      setLoading(false);
    }
  }

  async function copyHook(index: number, hook: string) {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(hook);
      setCopied(index);
    } catch {
      setCopied(null);
      setCopyError(true);
    }
  }

  const count = results?.length ?? 0;
  const completed = results?.filter(row => !failed(row)).length ?? 0;
  const hasWork = leads.length > 0;
  const progressLabel = loading ? 'Batch in progress' : results ? `${count} of ${leads.length} processed` : 'Waiting to start';

  return (
    <div className="batch-layout">
      <section className="panel upload-panel" aria-labelledby="upload-heading">
        <div className="section-title">
          <h2 id="upload-heading"><span className="section-index">/01</span> Upload leads</h2>
          <a className="text-action" href={sampleHref} download="leads.csv"><ArrowDownToLine size={16} />Download sample CSV</a>
        </div>
        <div className={`drop-area${dragging ? ' dragging' : ''}`}
          onDragOver={event => { event.preventDefault(); if (!loading) setDragging(true); }}
          onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
          onDrop={drop}>
          <span className="feature-icon">{file ? <FileSpreadsheet size={24} /> : <UploadCloud size={24} />}</span>
          <h3>{file ? file.name : 'Drop your CSV here'}</h3>
          <p>{file ? `${leads.length} ${leads.length === 1 ? 'lead' : 'leads'} ready to audit` : 'Upload up to 100 leads in one file.'}</p>
          <input ref={picker} type="file" aria-label="Lead CSV" accept=".csv,text/csv" hidden
            onChange={event => { void choose(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />
          <button type="button" className="secondary" disabled={loading} onClick={() => picker.current?.click()}>{file ? 'Replace CSV' : 'Browse files'}</button>
        </div>
        {error && <p className="error batch-error" role="alert">{error}</p>}
        {(hasWork || archive) && <div className="batch-actions">
          {archive ? <button className="primary" type="button" onClick={() => saveDownload(archive.blob, archive.name)}>
            <ArrowDownToLine size={16} /> Download ZIP
          </button> : <button className="primary" type="button" onClick={run} disabled={loading}>
            {loading ? 'Running batch…' : 'Run batch'} <ArrowRight size={16} />
          </button>}
        </div>}
      </section>

      <section className="panel batch-results" aria-labelledby="batch-results-heading" aria-busy={loading}>
        <div className="section-title">
          <h2 id="batch-results-heading"><span className="section-index">/02</span> {results ? 'Batch results' : 'Lead preview'}</h2>
          <span className={`tag ${loading ? 'active' : results && completed === count ? 'pass' : results ? 'partial' : ''}`}>
            {loading ? 'Running' : results ? 'Complete' : hasWork ? 'Queued' : 'Ready'}
          </span>
        </div>
        {!hasWork ? <div className="batch-empty"><FileSpreadsheet size={23} aria-hidden="true" /><p>Upload a CSV to preview your leads here.</p></div> : (
          <>
            <div className="batch-progress">
              <div><span id="batch-progress-label">{progressLabel}</span>{results && <span>{completed} reports</span>}</div>
              <progress aria-labelledby="batch-progress-label" max={leads.length} value={loading ? undefined : count} />
              {loading && <p className="hint" role="status">Individual outcomes are available when the batch finishes.</p>}
            </div>
            {copyError && <p className="error" role="status">Could not copy the hook. Open results.csv in the ZIP to copy it.</p>}
            <table className="lead-table">
              <thead><tr><th scope="col">Business</th><th scope="col">Status</th>
                {results && <><th scope="col">Score</th><th scope="col">Revenue / mo.</th><th scope="col">Top issue</th><th scope="col">Hook</th></>}
              </tr></thead>
              <tbody>{leads.map((lead, index) => {
                const row = results?.[index];
                const status = row ? failed(row) ? 'Failed' : 'Done' : loading ? 'Pending' : 'Queued';
                const hasRange = row && row.revenue_low !== '' && row.revenue_high !== '';
                return <tr key={index}>
                  <th scope="row">{row?.business || lead.business}</th>
                  <td className="lead-status"><span className={`tag ${status === 'Done' ? 'pass' : status === 'Failed' ? 'fail' : status === 'Pending' ? 'active' : ''}`}>{status}</span></td>
                  {row && <>
                    <td data-label="Score">{row.score === '' ? '–' : `${row.score}/100`}</td>
                    <td data-label="Revenue / mo.">{hasRange ? `${formatMoney(Number(row.revenue_low), lead.country)} to ${formatMoney(Number(row.revenue_high), lead.country)}` : '–'}</td>
                    <td data-label="Top issue">{row.top_issue || '–'}</td>
                    <td className="lead-copy">{row.hook && <button className="text-action" type="button" onClick={() => copyHook(index, row.hook)}
                      aria-label={`${copied === index ? 'Copied' : 'Copy hook for'} ${row.business}`}>
                      {copied === index ? <Check size={15} /> : <Copy size={15} />}{copied === index ? 'Copied' : 'Copy'}
                    </button>}</td>
                  </>}
                </tr>;
              })}</tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}
