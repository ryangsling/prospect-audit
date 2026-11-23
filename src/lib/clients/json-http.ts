export async function requestJson(url: URL, timeoutMs: number, init: RequestInit = {}): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const response = await fetch(url, { ...init, redirect: 'error', signal });
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
  return response.json();
}
