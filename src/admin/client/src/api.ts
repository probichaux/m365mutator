export interface ApiResult<T = Record<string, unknown>> {
  status: number;
  data: T;
}

// Registered by AuthProvider; called whenever any request gets a 401 so the
// app can drop the stale authenticated state and show the login page.
let _onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  _onUnauthorized = fn;
}

// skipUnauthorized=true suppresses the _onUnauthorized callback for this call.
// Use it for proactive auth-check endpoints (/api/status) where a 401 is expected
// when no session exists and should not be treated as a session expiry.
export async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
  skipUnauthorized?: boolean,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const opts: RequestInit = {
    method,
    headers,
    credentials: 'same-origin',
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(path, opts);
  if (res.status === 401 && _onUnauthorized && !skipUnauthorized) {
    _onUnauthorized();
  }
  let data: T;
  try {
    data = await res.json() as T;
  } catch {
    data = { error: `HTTP ${res.status}: ${res.statusText}` } as T;
  }
  return { status: res.status, data };
}
