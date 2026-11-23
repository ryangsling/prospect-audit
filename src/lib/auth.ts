export const sessionCookie = 'prospect_audit_session';
export const sessionSeconds = 8 * 60 * 60;

const encoder = new TextEncoder();
const encode = (value: string) => encoder.encode(value);
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');

export function configuredPassword() {
  const password = process.env.APP_PASSWORD;
  return password?.trim() ? password : null;
}

async function signingKey(password: string) {
  return crypto.subtle.importKey('raw', encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function passwordMatches(submitted: string, expected: string) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode(submitted)),
    crypto.subtle.digest('SHA-256', encode(expected)),
  ]);
  let difference = 0;
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];
  return difference === 0;
}

export async function createSession(password: string, now = Date.now()) {
  const payload = `${Math.floor(now / 1000) + sessionSeconds}.${crypto.randomUUID()}`;
  const signature = await crypto.subtle.sign('HMAC', await signingKey(password), encode(payload));
  return `${payload}.${hex(signature)}`;
}

export async function validSession(token: string | undefined, password: string, now = Date.now()) {
  const match = token?.match(/^(\d{1,12})\.([\da-f-]{36})\.([\da-f]{64})$/);
  if (!match) return false;
  const [, expiration, nonce, signature] = match;
  if (Number(expiration) <= Math.floor(now / 1000)) return false;
  const bytes = Uint8Array.from(signature.match(/.{2}/g) ?? [], pair => parseInt(pair, 16));
  return crypto.subtle.verify('HMAC', await signingKey(password), bytes, encode(`${expiration}.${nonce}`));
}
