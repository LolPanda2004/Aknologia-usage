export const usd = (v: number | undefined | null, digits = 2) =>
  v == null ? '—' : '$' + v.toLocaleString(undefined, { minimumFractionDigits: v >= 1000 ? 0 : digits, maximumFractionDigits: v >= 1000 ? 0 : digits });
export const num = (v: number) =>
  v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'K' : String(Math.round(v));
export const hours = (h: number) => (h < 1 ? Math.round(h * 60) + ' min' : h.toFixed(1) + ' h');
export const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min` : `${Math.round(m)} min`);
export function ago(iso?: string | null) {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (!t || t < 86400000) return 'never';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  if (s < 172800) return 'yesterday';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
export const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—');
export const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export function when(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const same = d.toDateString() === today.toDateString();
  return (same ? 'Today' : d.toLocaleDateString(undefined, { weekday: 'short' })) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
export const passwordRules = (pw: string, email = '') => [
  { text: 'At least 12 characters', ok: [...pw].length >= 12 },
  { text: 'A number', ok: /\d/.test(pw) },
  { text: 'A symbol', ok: /[^\p{L}\p{N}\s]/u.test(pw) },
  { text: 'Not your email', ok: pw.length > 0 && !(email.split('@')[0].length >= 4 && pw.toLowerCase().includes(email.split('@')[0].toLowerCase())) },
];
