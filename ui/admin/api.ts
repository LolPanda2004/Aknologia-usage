// Admin console API client. Same origin as the backend (served at /app/); set VITE_API_URL to point elsewhere.
const BASE = (import.meta.env.VITE_API_URL ?? '') + '/api/v1';
const KEY = 'akn-admin-token';

export const auth = {
  get token() { return localStorage.getItem(KEY); },
  set(t: string | null) { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); },
};

export class ApiError extends Error {
  constructor(public status: number, public kind: string, message: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(auth.token ? { Authorization: 'Bearer ' + auth.token } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!res.ok) {
    if (res.status === 401 && auth.token) { auth.set(null); window.location.hash = '#/signin'; }
    throw new ApiError(res.status, data.error ?? 'error', data.message ?? res.statusText);
  }
  return data as T;
}

const ua = navigator.userAgent;
export const client = { client: 'web', deviceName: ua.includes('Mac') ? 'Browser on macOS' : ua.includes('Windows') ? 'Browser on Windows' : 'Web browser', os: navigator.platform };

export async function download(path: string, filename: string) {
  const res = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + (auth.token ?? '') } });
  if (!res.ok) throw new Error('Export failed. Try again.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
