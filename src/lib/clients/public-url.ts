export function isGoogleMaps(url: URL) {
  const host = url.hostname.replace(/\.$/, '');
  if (host === 'maps.app.goo.gl') return true;
  const mapsPath = /^\/maps(?:\/|$)/i.test(url.pathname);
  if (host === 'goo.gl') return mapsPath;
  const google = /^(?:[a-z0-9-]+\.)*google\.(?:com|[a-z]{2,3}|(?:com|co)\.[a-z]{2})$/;
  return google.test(host) && (host.startsWith('maps.') || mapsPath);
}

export function isWebsiteUrl(url: URL) {
  return ['http:', 'https:'].includes(url.protocol)
    && !url.username && !url.password && !url.port && !isGoogleMaps(url);
}
