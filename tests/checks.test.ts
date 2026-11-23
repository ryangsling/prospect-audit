import { describe, expect, it } from 'vitest';
import { detectBooking } from '../src/lib/checks/booking';
import { detectChatbot } from '../src/lib/checks/chatbot';
import { detectHygiene } from '../src/lib/checks/hygiene';
import type { WebsiteScan } from '../src/lib/clients/website';
import { fixture } from './fixture';

function scan(html: string, url = 'https://business.example/'): WebsiteScan {
  const homepage = { url, html };
  return { homepage, pages: [homepage], failures: [] };
}

describe('online booking', () => {
  it.each([
    ['fresha-salon', 'Fresha'],
    ['calendly', 'Calendly'],
  ])('detects %s', (name, platform) => {
    expect(detectBooking(scan(fixture(name)))).toMatchObject({
      status: 'pass', details: { platform },
    });
  });

  it('distinguishes a generic quote form from self-serve booking', () => {
    expect(detectBooking(scan(fixture('contact-form'))).status).toBe('partial');
  });

  it('detects a form with an appointment date', () => {
    const html = '<form aria-label="Book an appointment"><input type="date" name="date"><button>Book</button></form>';
    expect(detectBooking(scan(html)).status).toBe('pass');
  });

  it('reports phone-only pages without booking', () => {
    expect(detectBooking(scan(fixture('phone-only-roofing'))).status).toBe('fail');
  });

  it('does not mistake a newsletter sign-up for a contact form', () => {
    const html = '<form action="/subscribe"><label>Email <input type="email" name="email"></label><button>Subscribe</button></form>';
    expect(detectBooking(scan(html)).status).toBe('fail');
  });

  it('ignores lookalike platform hostnames and mere mentions', () => {
    const html = '<a href="https://calendly.com.example/salon">Calendly information</a><p>Fresha</p>';
    expect(detectBooking(scan(html)).status).toBe('fail');
  });
});

describe('website chat', () => {
  it('detects a Tidio script', () => {
    expect(detectChatbot(scan(fixture('tidio')))).toMatchObject({
      status: 'pass', details: { platform: 'Tidio' },
    });
  });

  it('detects a DOM widget and inline initialization', () => {
    expect(detectChatbot(scan('<div id="intercom-container"></div>')).details?.platform).toBe('Intercom');
    expect(detectChatbot(scan('<script>window.$crisp=[]; window.CRISP_WEBSITE_ID="fixture";</script>')).details?.platform).toBe('Crisp');
  });

  it('reduces confidence for GTM-only sites', () => {
    expect(detectChatbot(scan(fixture('gtm-only')))).toMatchObject({
      status: 'fail',
      confidence: 'medium',
      evidence: 'Widgets loaded via Tag Manager may not be visible to this scan',
    });
  });

  it('reports phone-only pages without chat', () => {
    expect(detectChatbot(scan(fixture('phone-only-roofing'))).status).toBe('fail');
  });
});

describe('homepage hygiene', () => {
  it('reports all five positive checks', () => {
    expect(detectHygiene(scan(fixture('fresha-salon')))).toMatchObject({
      status: 'pass',
      details: { https: true, mobileViewport: true, clickToCall: true, title: true, description: true },
    });
  });

  it('reports individual failures on a partly configured homepage', () => {
    expect(detectHygiene(scan(fixture('phone-only-roofing'), 'http://business.example/'))).toMatchObject({
      status: 'partial',
      details: { https: false, mobileViewport: false, clickToCall: true, title: true, description: false },
    });
  });
});

it('returns not_checked for all three detectors when there is no readable HTML', () => {
  const unavailable: WebsiteScan = {
    homepage: null, pages: [], failures: [{ url: 'https://business.example/', reason: 'Website returned HTTP 503.' }],
  };
  for (const detect of [detectBooking, detectChatbot, detectHygiene]) {
    expect(detect(unavailable)).toMatchObject({ status: 'not_checked', confidence: 'low' });
  }
});

it('keeps homepage hygiene available when another page fails', () => {
  const partial = scan(fixture('phone-only-roofing'));
  partial.failures.push({ url: 'https://business.example/book', reason: 'Blocked by robots.txt.' });
  expect(detectBooking(partial).status).toBe('not_checked');
  expect(detectChatbot(partial).status).toBe('not_checked');
  expect(detectHygiene(partial).status).toBe('partial');
});
