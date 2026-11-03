// The desktop window talks only to the local agent (127.0.0.1). The agent holds the device token and proxies
// account calls to the server under /v1/server/*. Pairing: the Wails shell exposes AgentInfo(); in a browser
// during development, open the window with ?token=<output of `aknologia-agent -print-token`>.
declare global {
  interface Window { go?: { main?: { App?: { AgentInfo: () => Promise<{ url: string; token: string }> } } } }
}

let base = 'http://127.0.0.1:47811';
let token = new URLSearchParams(window.location.search).get('token') ?? localStorage.getItem('akn-agent-token') ?? '';

export async function pair() {
  try {
    const info = await window.go?.main?.App?.AgentInfo();
    if (info?.token) { base = info.url || base; token = info.token; }
  } catch { /* not running inside Wails */ }
  if (token) localStorage.setItem('akn-agent-token', token);
  return !!token;
}

export class AgentError extends Error { constructor(public status: number, public kind: string, message: string) { super(message); } }

export async function agent<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base + '/v1' + path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', 'X-Agent-Token': token },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new AgentError(0, 'agent_down', 'The Aknologia agent isn’t running. Start it from your Applications folder, or restart your computer.');
  }
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!res.ok) throw new AgentError(res.status, data.error ?? 'error', data.message ?? res.statusText);
  return data as T;
}

/** Account calls go through the agent's proxy so the device token never reaches the window. */
export const server = (path: string, opts?: { method?: string; body?: unknown }) => agent('/server' + path, opts);
