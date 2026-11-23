import { checkWeight } from './checks/score';
import type { CheckResult } from './checks/types';

const suggestions: Record<string, string> = {
  booking: 'Add self-serve online booking so visitors can schedule an appointment whenever they are ready.',
  chatbot: 'Add a chat option so visitors can ask questions before they leave the website.',
  after_hours: 'Offer a way for visitors to send inquiries or book when the business is closed.',
  mobile_speed: 'Improve mobile load time so visitors can see the main content sooner.',
  reviews: 'Reply to recent reviews, starting with unanswered concerns from customers.',
  hygiene: 'Make the homepage secure, mobile-friendly, and easy to call from.',
};

export function auditFixes(checks: CheckResult[]) {
  return checks.filter(check => check.status === 'fail' && Object.hasOwn(suggestions, check.id))
    .sort((a, b) => checkWeight(b.id) - checkWeight(a.id))
    .slice(0, 3)
    .map(check => suggestions[check.id]);
}
