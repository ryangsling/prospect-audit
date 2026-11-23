import { expect, it, vi } from 'vitest';
import { getPublicPage, type HttpResponse } from '../src/lib/clients/public-http';
import { scanWebsite } from '../src/lib/clients/website';
import { fixture } from './fixture';

const origin = 'https://business.example';

function response(text: string, status = 200, contentType = 'text/html'): HttpResponse {
  return { status, text, contentType };
}

function mockWebsite(pages: Record<string, HttpResponse | Error>) {
  return vi.fn(async (url: URL, signal: AbortSignal) => {
    signal.throwIfAborted();
    const result = pages[url.href];
    if (!result) throw new Error('Unexpected URL in fixture transport.');
    if (result instanceof Error) throw result;
    return result;
  });
}

it('follows homepage redirects and checks the destination robots policy before fetching', async () => {
  const moved = 'https://www.business.example';
  const get = mockWebsite({
    [origin + '/robots.txt']: response('', 404),
    [origin + '/']: { ...response('', 301), location: moved + '/home' },
    [moved + '/robots.txt']: response('User-agent: *\nDisallow: /private\n', 200, 'text/plain'),
    [moved + '/home']: response('<a href="/private">Book</a><a href="/info">Contact</a>'),
    [moved + '/info']: response(fixture('calendly')),
  });

  const result = await scanWebsite(new URL(origin), get);
  expect(result.homepage?.url).toBe(moved + '/home');
  expect(result.pages.map(page => page.url)).toEqual([moved + '/home', moved + '/info']);
  expect(result.failures).toEqual([{ url: moved + '/private', reason: 'Blocked by robots.txt.' }]);
  expect(get.mock.calls.map(([url]) => url.href)).toEqual([
    origin + '/robots.txt', origin + '/', moved + '/robots.txt', moved + '/home', moved + '/info',
  ]);
});

it('reads at most five distinct relevant internal links and continues when one fails', async () => {
  const links = [
    '<a href="/irrelevant">About</a>',
    '<a href="https://external.example/book">Book elsewhere</a>',
    '<a href="/contact#form">Contact us</a>',
    '<a href="/contact#hours">Contact hours</a>',
    '<a href="/appointments">Schedule</a>',
    '<a href="/reserve">Reserve</a>',
    '<a href="/some-page">Request a quote</a>',
    '<a href="/booking">Booking</a>',
    '<a href="/quote">Quote</a>',
  ];
  const get = mockWebsite({
    [origin + '/robots.txt']: response('', 404),
    [origin + '/']: response(links.join('')),
    [origin + '/contact']: new Error('Connection reset'),
    [origin + '/appointments']: response(fixture('calendly')),
    [origin + '/reserve']: response('<p>Reserve</p>'),
    [origin + '/some-page']: response(fixture('contact-form')),
    [origin + '/booking']: response(fixture('fresha-salon')),
  });

  const result = await scanWebsite(new URL(origin + '/#home'), get);
  expect(get.mock.calls.map(([url]) => url.href)).toEqual([
    origin + '/robots.txt', origin + '/', origin + '/contact', origin + '/appointments',
    origin + '/reserve', origin + '/some-page', origin + '/booking',
  ]);
  expect(result.pages).toHaveLength(5);
  expect(result.failures).toEqual([{ url: origin + '/contact', reason: 'Website request failed.' }]);
});

it('does not follow a relevant internal page to another origin', async () => {
  const get = mockWebsite({
    [origin + '/robots.txt']: response('', 404),
    [origin + '/']: response('<a href="/book">Book</a>'),
    [origin + '/book']: { ...response('', 302), location: 'https://unrelated.example/' },
  });
  const result = await scanWebsite(new URL(origin), get);
  expect(result.failures[0].reason).toBe('Internal page redirected outside the website.');
  expect(get).toHaveBeenCalledTimes(3);
});

it('does not retrieve Google Maps HTML through a redirect', async () => {
  const get = mockWebsite({
    [origin + '/robots.txt']: response('', 404),
    [origin + '/']: { ...response('', 302), location: 'https://www.google.co.uk/maps/place/example' },
  });
  const result = await scanWebsite(new URL(origin), get);
  expect(result.homepage).toBeNull();
  expect(get).toHaveBeenCalledTimes(2);
});

it('records an unavailable homepage without parsing its error body', async () => {
  const get = mockWebsite({
    [origin + '/robots.txt']: response('', 404),
    [origin + '/']: response(fixture('broken'), 503),
  });
  expect(await scanWebsite(new URL(origin), get)).toEqual({
    homepage: null, pages: [],
    failures: [{ url: origin + '/', reason: 'Website returned HTTP 503.' }],
  });
});

it('holds the scan when robots.txt is unavailable', async () => {
  const get = mockWebsite({ [origin + '/robots.txt']: response('', 503) });
  expect((await scanWebsite(new URL(origin), get)).failures[0].reason).toBe('robots.txt could not be verified.');
  expect(get).toHaveBeenCalledTimes(1);
});

it('rejects private destinations before attempting a connection', async () => {
  await expect(getPublicPage(new URL('http://127.0.0.1/'), new AbortController().signal))
    .rejects.toThrow('outside the public website scan scope');
});
