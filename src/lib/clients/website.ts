import { load } from 'cheerio';
import robotsParser from 'robots-parser';
import { isWebsiteUrl } from './public-url';
import { crawlerName, getPublicPage, type HttpClient, type HttpResponse } from './public-http';

export type WebsitePage = { url: string; html: string };
export type PageFailure = { url: string; reason: string };
export type WebsiteScan = {
  homepage: WebsitePage | null;
  pages: WebsitePage[];
  failures: PageFailure[];
};

const pageTimeoutMs = 10_000;
const maxRedirects = 5;
const internalPageLimit = 5;
const redirects = new Set([301, 302, 303, 307, 308]);
const relevant = /book(?:ing)?|appointment|schedule|reserve|quote|contact/i;

class ScanError extends Error {}

function normalize(url: URL) {
  url.hash = '';
  return url;
}

function discoverPages(homepage: WebsitePage) {
  const $ = load(homepage.html);
  const origin = new URL(homepage.url).origin;
  let base = homepage.url;
  const baseHref = $('base[href]').first().attr('href');
  if (baseHref) {
    try {
      base = new URL(baseHref, base).href;
    } catch {
      // Resolve relative links against the final homepage URL when base is invalid.
    }
  }
  const urls = new Map<string, URL>();
  $('a[href]').each((_, anchor) => {
    const href = $(anchor).attr('href')?.trim();
    if (!href || href.startsWith('#') || !relevant.test(href + ' ' + $(anchor).text())) return;
    try {
      const url = normalize(new URL(href, base));
      if (url.origin === origin && url.href !== homepage.url && isWebsiteUrl(url)) urls.set(url.href, url);
    } catch {
      // A malformed anchor does not affect the scan.
    }
  });
  return [...urls.values()];
}

export async function scanWebsite(input: URL, get: HttpClient = getPublicPage, scanSignal?: AbortSignal): Promise<WebsiteScan> {
  const policies = new Map<string, Promise<ReturnType<typeof robotsParser> | null>>();

  async function follow(
    start: URL,
    signal: AbortSignal,
    beforeRequest: (url: URL) => Promise<void>,
  ): Promise<{ url: URL; response: HttpResponse }> {
    let url = start;
    const seen = new Set<string>();
    for (let i = 0; i <= maxRedirects; i++) {
      if (!isWebsiteUrl(url)) throw new ScanError('URL is outside the website scan scope.');
      if (seen.has(url.href)) throw new ScanError('Redirect loop.');
      seen.add(url.href);
      await beforeRequest(url);
      signal.throwIfAborted();
      const response = await get(url, signal);
      if (!redirects.has(response.status)) return { url, response };
      if (!response.location) throw new ScanError('Redirect has no destination.');
      try {
        url = normalize(new URL(response.location, url));
      } catch {
        throw new ScanError('Redirect has an invalid destination.');
      }
    }
    throw new ScanError('Too many redirects.');
  }

  async function readPolicy(origin: string, signal: AbortSignal) {
    const robotsUrl = new URL('/robots.txt', origin);
    try {
      const { response } = await follow(robotsUrl, signal, async () => {});
      if (response.status === 404 || response.status === 410) return null;
      if (response.status >= 200 && response.status < 300 && response.status !== 206) {
        return robotsParser(robotsUrl.href, response.text);
      }
    } catch {
      signal.throwIfAborted();
    }
    throw new ScanError('robots.txt could not be verified.');
  }

  async function enforcePolicy(url: URL, signal: AbortSignal) {
    let policy = policies.get(url.origin);
    if (!policy) {
      const origin = url.origin;
      policy = readPolicy(origin, signal).catch(error => {
        policies.delete(origin);
        throw error;
      });
      policies.set(origin, policy);
    }
    const rules = await policy;
    const botAllowed = rules?.isAllowed(url.href, crawlerName);
    if (botAllowed === false) {
      throw new ScanError('Blocked by robots.txt.');
    }
  }

  const failures: PageFailure[] = [];
  async function scanPage(url: URL, origin?: string): Promise<WebsitePage | null> {
    const timeout = AbortSignal.timeout(pageTimeoutMs);
    const signal = scanSignal ? AbortSignal.any([scanSignal, timeout]) : timeout;
    try {
      const result = await follow(url, signal, async destination => {
        if (origin && destination.origin !== origin) {
          throw new ScanError('Internal page redirected outside the website.');
        }
        await enforcePolicy(destination, signal);
      });
      const { response } = result;
      if (response.status < 200 || response.status >= 300 || response.status === 206) {
        throw new ScanError(`Website returned HTTP ${response.status}.`);
      }
      if (!/^(?:text\/html|application\/xhtml\+xml)(?:\s*;|\s*$)/i.test(response.contentType ?? '')
        || !response.text.trim()) {
        throw new ScanError('Website did not return an HTML page.');
      }
      return { url: result.url.href, html: response.text };
    } catch (error) {
      const reason = signal.aborted ? 'Website request timed out.'
        : error instanceof ScanError ? error.message : 'Website request failed.';
      failures.push({ url: url.href, reason });
      return null;
    }
  }

  const homepage = await scanPage(normalize(new URL(input)));
  if (!homepage) return { homepage, pages: [], failures };

  const pages = [homepage];
  const visited = new Set([homepage.url]);
  for (const url of discoverPages(homepage).slice(0, internalPageLimit)) {
    if (visited.has(url.href)) continue;
    const page = await scanPage(url, new URL(homepage.url).origin);
    if (page && !visited.has(page.url)) {
      pages.push(page);
      visited.add(page.url);
    }
  }
  return { homepage, pages, failures };
}
