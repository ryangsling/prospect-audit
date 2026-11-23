import { load } from 'cheerio';
import type { WebsiteScan } from '../clients/website';
import { onDomain, resourceUrl } from './resource-url';
import type { CheckResult } from './types';

const check = { id: 'chatbot', label: 'Website chatbot or live chat' };
type ChatProvider = {
  name: string;
  domains?: string[];
  path?: RegExp;
  markers?: string;
  code?: RegExp;
};

const platforms: ChatProvider[] = [
  { name: 'Intercom', domains: ['widget.intercom.io', 'js.intercomcdn.com'], markers: '#intercom-container, .intercom-lightweight-app',
    code: /\b(?:window\.)?intercomSettings\s*=|\bIntercom\s*\(\s*['"]boot['"]/ },
  { name: 'Drift', domains: ['js.driftt.com', 'widget.drift.com'], markers: '#drift-widget',
    code: /\bdrift\s*\.\s*load\s*\(/ },
  { name: 'Tidio', domains: ['code.tidio.co', 'code.tidio.com'], markers: '#tidio-chat, #tidio-chat-iframe',
    code: /\bwindow\.tidioChatApi\s*=/ },
  { name: 'Crisp', domains: ['client.crisp.chat'], markers: '.crisp-client',
    code: /\bCRISP_WEBSITE_ID\s*=|\$crisp\.push\s*\(/ },
  { name: 'tawk.to', domains: ['embed.tawk.to'], markers: '#tawkchat-container, iframe[title="chat widget"]#tawkchat',
    code: /\bTawk_API\s*=|\bTawk_LoadStart\s*=/ },
  { name: 'LiveChat', domains: ['cdn.livechatinc.com', 'secure.livechatinc.com'], markers: '#livechat-compact-container, #chat-widget-container iframe[src*="livechatinc.com"]',
    code: /\b__lc\.license\s*=|\bLiveChatWidget\.init\s*\(/ },
  { name: 'Zendesk Chat', domains: ['static.zdassets.com'], path: /\/ekr\/snippet\.js/i,
    markers: '#ze-snippet, .zopim', code: /\bzE\s*\(\s*['"](?:webWidget|messenger)['"]|\$zopim\s*\(/ },
  { name: 'Zendesk Chat', domains: ['v2.zopim.com', 'widget-mediator.zopim.com'] },
  { name: 'HubSpot chat', domains: ['js.usemessages.com', 'js.hs-chatier.com'], markers: '#hubspot-messages-iframe-container, #hubspot-conversations-iframe',
    code: /\b(?:window\.)?hsConversationsSettings\s*=|\bHubSpotConversations\.widget\./ },
  { name: 'Freshchat', domains: ['wchat.freshchat.com', 'fw-cdn.com', 'chat-assets.frontdoor.freshworks.com'], markers: '#fc_frame, #fc_widget',
    code: /\bfcWidget\.init\s*\(/ },
  { name: 'Olark', domains: ['static.olark.com'], markers: '#olark-wrapper, .olark-launch-button',
    code: /\bolark\.identify\s*\(/ },
  { name: 'LeadConnector', domains: ['widgets.leadconnectorhq.com', 'beta.leadconnectorhq.com'], path: /chat[-_]widget|\/loader\.js/i,
    markers: 'chat-widget[location-id], [data-chat-widget], #lc-chat-widget' },
  { name: 'Podium', domains: ['connect.podium.com', 'webchat.podium.com'], markers: '#podium-webchat, #podium-website-widget', code: /\bPodiumWebChat\s*[.=]/ },
  { name: 'Birdeye', domains: ['birdeye.com'], path: /webchat|chat[-_]?widget/i,
    markers: '#birdeye-chat-widget, #birdeye-webchat' },
  { name: 'Facebook Messenger', domains: ['connect.facebook.net', 'facebook.com'], path: /customerchat|plugins\/customer_chat/i,
    markers: '.fb-customerchat, #fb-customer-chat' },
  { name: 'Botpress', domains: ['cdn.botpress.cloud', 'webchat.botpress.cloud', 'mediafiles.botpress.cloud'], path: /webchat|\/web\/|\/.*\/.*\.js/i,
    markers: '#bp-web-widget, .bpWebchat', code: /\b(?:botpress|botpressWebChat)\.init\s*\(/ },
  { name: 'Voiceflow', domains: ['cdn.voiceflow.com'], path: /widget/i,
    markers: '#voiceflow-chat, #voiceflow-chat-widget', code: /\bvoiceflow\.chat\.load\s*\(/ },
  { name: 'Chatbase', domains: ['chatbase.co'], path: /(?:\/embed|\/chatbot-iframe)/i,
    markers: '#chatbase-bubble-button, #chatbase-bubble-window', code: /\bwindow\.chatbase\s*=/ },
];

const gtmCode = /googletagmanager\.com\/gtm\.js|\bGTM-[A-Z0-9]+\b/i;
const runnableScript = /^(?:|module|(?:application|text)\/(?:java|ecma)script)$/i;

export function detectChatbot(scan: WebsiteScan): CheckResult {
  let tagManager = false;
  for (const page of scan.pages) {
    const $ = load(page.html, { scriptingEnabled: false });
    const base = resourceUrl($('base[href]').first().attr('href') ?? '', page.url)?.href ?? page.url;
    const resources = $('script[src], iframe[src]').toArray()
      .map(element => resourceUrl($(element).attr('src') ?? '', base));
    const scripts = $('script:not([src])').toArray()
      .filter(element => runnableScript.test(($(element).attr('type') ?? '').trim()))
      .map(element => $(element).text());
    const provider = platforms.find(candidate =>
      (candidate.markers && $(candidate.markers).length > 0)
      || (candidate.code && scripts.some(script => candidate.code?.test(script)))
      || resources.some(url => url && candidate.domains?.some(domain => onDomain(url.hostname, domain))
        && (candidate.path?.test(url.pathname) ?? true)));
    if (provider) {
      return { ...check, status: 'pass', confidence: 'high', evidence: `Found markers for the ${provider.name} chat widget.`,
        details: { platform: provider.name, page: page.url } };
    }

    tagManager ||= resources.some(url => Boolean(url && onDomain(url.hostname, 'googletagmanager.com')
      && ['/gtm.js', '/ns.html'].includes(url.pathname))) || scripts.some(script => gtmCode.test(script));
  }
  if (tagManager) {
    return { ...check, status: scan.failures.length ? 'not_checked' : 'fail', confidence: 'medium',
      evidence: 'Widgets loaded via Tag Manager may not be visible to this scan' };
  }
  if (!scan.homepage || scan.failures.length) {
    return { ...check, status: 'not_checked', confidence: 'low',
      evidence: 'One or more pages could not be read, so a chat widget could not be ruled out.' };
  }
  return { ...check, status: 'fail', confidence: 'high', evidence: 'No chat widget was detected in the HTML checked.' };
}
