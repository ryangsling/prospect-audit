import { load } from 'cheerio';
import type { WebsiteScan } from '../clients/website';
import type { CheckResult } from './types';

const check = { id: 'hygiene', label: 'Basic website hygiene' };

export function detectHygiene(scan: WebsiteScan): CheckResult {
  if (!scan.homepage) {
    return { ...check, status: 'not_checked', confidence: 'low', evidence: 'The homepage could not be read.' };
  }
  const $ = load(scan.homepage.html);
  const meta = (name: string) => $('meta[name]').toArray().some(element =>
    $(element).attr('name')?.trim().toLowerCase() === name && Boolean($(element).attr('content')?.trim()));
  const details = {
    https: new URL(scan.homepage.url).protocol === 'https:',
    mobileViewport: meta('viewport'),
    clickToCall: $('a[href]').toArray().some(element => /^tel:\s*\+?[\d(). -]*\d/i.test($(element).attr('href')?.trim() ?? '')),
    title: Boolean($('head > title').first().text().trim()),
    description: meta('description'),
  };
  const missing = [
    [details.https, 'HTTPS'],
    [details.mobileViewport, 'mobile viewport'],
    [details.clickToCall, 'click-to-call link'],
    [details.title, 'page title'],
    [details.description, 'meta description'],
  ].filter(([present]) => !present).map(([, label]) => label);
  return {
    ...check,
    status: missing.length === 0 ? 'pass' : missing.length === 5 ? 'fail' : 'partial',
    confidence: 'high',
    evidence: missing.length === 0 ? 'All five homepage hygiene checks passed.' : `Homepage is missing ${missing.join(', ')}.`,
    details,
  };
}
