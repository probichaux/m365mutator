export interface ApiResult<T = Record<string, unknown>> {
  status: number;
  data: T;
}

export async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
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
  let data: T;
  try {
    data = await res.json() as T;
  } catch {
    data = { error: `HTTP ${res.status}: ${res.statusText}` } as T;
  }
  return { status: res.status, data };
}
