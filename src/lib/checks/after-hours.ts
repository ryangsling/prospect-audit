import { load } from 'cheerio';
import { weeklyClosedHours, type Listing } from '../clients/listing';
import type { WebsiteScan } from '../clients/website';
import type { CheckResult } from './types';

export function detectAfterHours(scan: WebsiteScan, listing: Listing | null, booking: CheckResult, chat: CheckResult): CheckResult {
  const base = { id: 'after_hours', label: 'After-hours contact' };
  const closedHours = listing?.openingPeriods ? weeklyClosedHours(listing.openingPeriods) : null;
  const details = { weeklyClosedHours: closedHours };
  if (booking.status === 'pass') {
    return { ...base, details, status: 'pass', confidence: booking.confidence, evidence: 'Visitors can use self-serve booking outside business hours.' };
  }

  let sms = false;
  let afterHours = false;
  let aiReceptionist = false;
  let phone = Boolean(listing?.phone);
  for (const page of scan.pages) {
    const $ = load(page.html);
    $('script, style, template').remove();
    const text = $('body').text().replace(/\s+/g, ' ');
    sms ||= $('a[href]').toArray().some(link => /^sms:\+?[\d(]/i.test($(link).attr('href') ?? ''))
      || /\b(?:text us|send (?:us )?(?:an )?sms)\b/i.test(text);
    afterHours ||= /\b(?:24\s*(?:\/|\x2d)\s*7|24 hours a day|after[- ]hours|emergency (?:service|line|contact))\b/i.test(text);
    aiReceptionist ||= /\b(?:AI|automated|virtual) (?:phone )?receptionist\b/i.test(text);
    phone ||= $('a[href]').toArray().some(link => /^tel:\+?[\d(]/i.test($(link).attr('href') ?? ''));
  }

  if (chat.status === 'pass' && (chat.details?.platform === 'Botpress' || chat.details?.platform === 'Voiceflow' || chat.details?.platform === 'Chatbase')) {
    return { ...base, details, status: 'pass', confidence: 'medium', evidence: 'Found a chatbot that can receive inquiries outside business hours.' };
  }
  if (sms || aiReceptionist || (afterHours && phone)) {
    const channel = aiReceptionist ? 'an automated receptionist' : sms ? 'a text contact option' : 'an advertised after-hours phone option';
    return { ...base, details, status: 'pass', confidence: 'medium', evidence: `Website advertises ${channel}.` };
  }
  if (closedHours === 0) {
    return { ...base, details, status: 'pass', confidence: 'high', evidence: 'The listing reports round-the-clock opening hours.' };
  }
  if (booking.status === 'partial' || chat.status === 'pass') {
    return { ...base, details, status: 'partial', confidence: 'medium', evidence: 'Visitors can leave a message. After-hours replies could not be verified.' };
  }
  if (closedHours === null || !scan.homepage || booking.status === 'not_checked' || chat.status === 'not_checked') {
    return { ...base, details, status: 'not_checked', confidence: 'low', evidence: closedHours === null
      ? 'Weekly opening hours could not be verified.' : 'The website scan could not verify an after-hours contact option.' };
  }
  return { ...base, details, status: 'fail', confidence: 'medium', evidence: phone
    ? 'Published hours include closures. No after-hours alternative to calling was found.'
    : 'Published hours include closures. No after-hours contact option was found.' };
}
