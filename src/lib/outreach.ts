import { checkWeight } from './checks/score';
import type { CheckResult } from './checks/types';

export function worstFinding(checks: CheckResult[]) {
  return checks.filter(check => check.status === 'fail')
    .sort((a, b) => checkWeight(b.id) - checkWeight(a.id))[0] ?? null;
}

export function outreachHook(checks: CheckResult[], firstName: string | null) {
  const finding = worstFinding(checks);
  if (!finding) return null;

  const language: Record<string, string> = {
    booking: 'I couldn’t find a way to book online',
    chatbot: 'I couldn’t find a chat option on your website',
    after_hours: 'I couldn’t find a way for customers to reach you after hours',
    mobile_speed: typeof finding.details?.lcpMs === 'number'
      ? `the main content took about ${(finding.details.lcpMs / 1000).toFixed(1)} seconds to appear on mobile`
      : 'your website scored low in the mobile speed test',
    reviews: 'some of your recent Google reviews haven’t received a reply',
    hygiene: 'I spotted a few basics missing from the homepage',
  };
  const evidence = language[finding.id];
  if (!evidence) return null;
  const greeting = firstName ? `Hi ${firstName.replace(/[\r\n]+/g, ' ').trim()}, ` : '';
  const findingText = evidence[0].toUpperCase() + evidence.slice(1);
  return `${greeting}I ran a quick check on your website. ${findingText}. I made a one-page audit. Want me to send it over?`.replace(/—/g, '-');
}
