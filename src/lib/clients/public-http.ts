import { lookup } from 'node:dns';
import { get as getHttp } from 'node:http';
import { get as getHttps } from 'node:https';
import type { LookupFunction } from 'node:net';
import ipaddr from 'ipaddr.js';
import { isWebsiteUrl } from './public-url';

export const crawlerName = 'ProspectAudit';
const userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 ${crawlerName}/1.0`;

export type HttpResponse = {
  status: number;
  contentType?: string;
  location?: string;
  text: string;
};

export type HttpClient = (url: URL, signal: AbortSignal) => Promise<HttpResponse>;

function isPublicAddress(address: string) {
  const ip = ipaddr.process(address);
  return ip.range() === 'unicast'
    && (ip instanceof ipaddr.IPv4 || ip.match(ipaddr.IPv6.parse('2000::'), 3));
}

const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return callback(error, '', 0);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      return callback(new Error('Host does not resolve exclusively to public addresses.'), '', 0);
    }
    // Return the validated addresses directly to the socket without a second resolution.
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
};

const maxBodyBytes = 2 * 1024 * 1024;

export const getPublicPage: HttpClient = (url, signal) => {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (!isWebsiteUrl(url) || (ipaddr.isValid(hostname) && !isPublicAddress(hostname))) {
    return Promise.reject(new Error('URL is outside the public website scan scope.'));
  }
  const get = url.protocol === 'https:' ? getHttps : getHttp;
  return new Promise((resolve, reject) => {
    const request = get(url, {
      agent: false,
      lookup: publicLookup,
      signal,
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/html, application/xhtml+xml, text/plain;q=0.9',
        'Accept-Encoding': 'identity',
      },
    }, response => {
      const status = response.statusCode ?? 0;
      const contentType = response.headers['content-type'];
      const location = response.headers.location;
      response.on('error', reject);

      if (status < 200 || status >= 300 || status === 206) {
        resolve({ status, contentType, location, text: '' });
        response.destroy();
        return;
      }

      const encoding = response.headers['content-encoding'];
      if (encoding && encoding.toLowerCase() !== 'identity') {
        reject(new Error('Unsupported content encoding.'));
        response.destroy();
        return;
      }

      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBodyBytes) {
          reject(new Error('Response exceeds the scan size limit.'));
          response.destroy();
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const charset = contentType?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
        let decoder = new TextDecoder();
        if (charset) {
          try {
            decoder = new TextDecoder(charset);
          } catch {
            // Unknown charset labels fall back to UTF-8.
          }
        }
        resolve({ status, contentType, location, text: decoder.decode(Buffer.concat(chunks, bytes)) });
      });
    });
    request.on('error', reject);
  });
};
