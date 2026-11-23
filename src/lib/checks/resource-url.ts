export function onDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith('.' + domain);
}

export function resourceUrl(href: string, base: string) {
  if (!href.trim()) return undefined;
  try {
    const url = new URL(href, base);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url;
  } catch {
    // Malformed resource URLs provide no evidence.
  }
  return undefined;
}
