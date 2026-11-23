import { load } from 'cheerio';
import type { WebsiteScan } from '../clients/website';
import { onDomain, resourceUrl } from './resource-url';
import type { CheckResult } from './types';

const check = { id: 'booking', label: 'Online booking' };
type BookingProvider = {
  name: string;
  domains: string[];
  path?: RegExp;
};

const platforms: BookingProvider[] = [
  { name: 'Calendly', domains: ['calendly.com'] },
  { name: 'Acuity Scheduling', domains: ['acuityscheduling.com', 'as.me'] },
  { name: 'Square Appointments', domains: ['square.site', 'squareup.com'], path: /(?:^|\/)(?:appointments|book|booking)(?:\/|$)/i },
  { name: 'Fresha', domains: ['fresha.com'], path: /^\/(?:a|book-now|book|booking|providers|v)\//i },
  { name: 'Booksy', domains: ['booksy.com'], path: /\/\d+[_-]|\/book(?:ing)?(?:\/|$)/i },
  { name: 'Vagaro', domains: ['vagaro.com'], path: /^\/(?:widgets\/|[^/]+(?:\/book-now|\/services|$))/i },
  { name: 'GlossGenius', domains: ['glossgenius.com'], path: /^\/(?:book|services)(?:\/|$)/i },
  { name: 'Setmore', domains: ['setmore.com'] },
  { name: 'SimplyBook.me', domains: ['simplybook.me', 'simplybook.it'] },
  { name: 'Mindbody', domains: ['mindbodyonline.com'], path: /\/(?:classic|launch|widgets|studio|book)(?:\/|$)/i },
  { name: 'Mindbody', domains: ['healcode.com'] },
  { name: 'Boulevard', domains: ['joinblvd.com'], path: /\/(?:booking|widget)(?:\/|$)/i },
  { name: 'Phorest', domains: ['phorest.com'], path: /\/book(?:s|ing)?(?:\/|$)/i },
  { name: 'Timely', domains: ['gettimely.com'], path: /\/(?:book|bookings|booking)(?:\/|$)/i },
  { name: 'Treatwell', domains: ['treatwell.com', 'treatwell.co.uk', 'treatwell.de', 'treatwell.fr', 'treatwell.nl', 'treatwell.ie', 'treatwell.es', 'treatwell.it', 'treatwell.be'], path: /\/(?:place|salon|venue|bookings?|reserver|bookingwidget)(?:\/|$)/i },
  { name: 'Zenoti', domains: ['zenoti.com'], path: /\/(?:webstore(?:new)?|onlinebooking|booking|appointments)(?:\/|$)/i },
  { name: 'Jobber', domains: ['getjobber.com'], path: /\/book(?:ing|_now)?(?:\/|$)/i },
  { name: 'Housecall Pro', domains: ['housecallpro.com'], path: /\/(?:book|bookings?|schedule|pro\/book)(?:\/|$)/i },
  { name: 'ServiceTitan', domains: ['servicetitan.com'], path: /\/(?:book|booking|scheduler|schedule)(?:\/|$)/i },
  { name: 'LeadConnector or HighLevel', domains: ['leadconnectorhq.com', 'gohighlevel.com', 'msgsndr.com'], path: /\/widget\/(?:booking|booking-widget|calendar|service-menu)(?:\/|$)/i },
  { name: 'Google Calendar', domains: ['calendar.google.com', 'calendar.app.google'], path: /^\/(?:calendar\/.*(?:appointments|schedules)|[\w-]{9,})(?:\/|$)/i },
  { name: 'Dentrix', domains: ['dentrix.com', 'dentrixascend.com'], path: /\/(?:book|booking|onlinebooking|patient-appointments)(?:\/|$)/i },
  { name: 'NexHealth', domains: ['nexhealth.com'], path: /\/(?:book|booking|appointments?|appts|widget)(?:\/|$)/i },
  { name: 'Zocdoc', domains: ['zocdoc.com'], path: /^\/(?:doctor|practice|booking|widget)\//i },
];

const genericContact = /contact|quote|enquir|inquir|message|request a callback/i;
const appointment = /book(?:ing)?|appoint|schedul|reserv/i;
const marketingPath = /^\/(?:blog|about|pricing|resources|features|support|help|careers|privacy|terms)(?:\/|$)/i;

export function detectBooking(scan: WebsiteScan): CheckResult {
  let contactForm = false;
  for (const page of scan.pages) {
    const $ = load(page.html);
    const base = resourceUrl($('base[href]').first().attr('href') ?? '', page.url)?.href ?? page.url;
    for (const element of $('a[href], iframe[src], script[src]').toArray()) {
      const href = $(element).attr('href') ?? $(element).attr('src') ?? '';
      const url = resourceUrl(href, base);
      if (!url || marketingPath.test(url.pathname)) continue;
      const platform = platforms.find(candidate =>
        candidate.domains.some(domain => onDomain(url.hostname, domain))
        && (candidate.path?.test(url.pathname) ?? url.pathname !== '/'));
      if (platform) {
        return { ...check, status: 'pass', confidence: 'high', evidence: `Found a ${platform.name} booking link or widget.`,
          details: { platform: platform.name, page: page.url } };
      }
    }

    for (const element of $('form').toArray()) {
      const form = $(element);
      const fields = form.find('input:not([type="hidden"]), select, textarea');
      if (!fields.length) continue;
      const context = [form.attr('action'), form.attr('id'), form.attr('class'), form.attr('aria-label'), form.text()].join(' ');
      const fieldNames = fields.toArray().map(field =>
        [$(field).attr('name'), $(field).attr('type'), $(field).attr('aria-label')].join(' ')).join(' ');
      const date = fields.filter('input[type="date"]').length > 0;
      const time = fields.filter('input[type="time"]').length > 0;
      const dateTime = fields.filter('input[type="datetime-local"]').length > 0;
      if ((date && time) || ((date || time || dateTime) && appointment.test(context + ' ' + fieldNames))) {
        return { ...check, status: 'pass', confidence: 'medium', evidence: 'Found a form that offers a date or time for booking.',
          details: { page: page.url } };
      }
      contactForm ||= genericContact.test(context + ' ' + fieldNames)
        || (fields.is('textarea') && fields.is('input:is([type="email"], [type="tel"])'));
    }
  }

  if (contactForm) {
    return { ...check, status: 'partial', confidence: scan.failures.length || !scan.homepage ? 'low' : 'medium',
      evidence: 'Found a contact or quote form. No self-serve booking was detected on the pages checked.' };
  }
  if (!scan.homepage || scan.failures.length) {
    return { ...check, status: 'not_checked', confidence: 'low',
      evidence: 'One or more pages could not be read, so online booking could not be ruled out.' };
  }
  return { ...check, status: 'fail', confidence: 'medium', evidence: 'No online booking or contact form was detected on the pages checked.' };
}
