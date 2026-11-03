import { useState } from 'react';
import { Card, Empty, Field, Pill } from './ui';
import { Icon } from './icons';
import { date } from './format';
import { useAsync } from './hooks';
import type { Call } from './Security';

type Kind = 'bug' | 'feature' | 'question';
const KINDS: { k: Kind; title: string; body: string }[] = [
  { k: 'bug', title: 'Report a bug', body: 'Something broken or numbers that look wrong.' },
  { k: 'feature', title: 'Request a feature', body: 'An idea that would make this more useful.' },
  { k: 'question', title: 'Ask a question', body: 'How something works, billing, or your account.' },
];

export default function Support({ call, admin, toast, diagnostics }: { call: Call; admin?: boolean; toast: (t: string) => void; diagnostics?: () => Promise<Record<string, unknown>> }) {
  const tickets = useAsync(() => call('/support/tickets'), []);
  const [kind, setKind] = useState<Kind>('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState('Numbers look wrong');
  const [started, setStarted] = useState('');
  const [diag, setDiag] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const d = diag ? { userAgent: navigator.userAgent, ...(diagnostics ? await diagnostics() : {}) } : undefined;
      const r = await call('/support/tickets', { body: { kind, title, body, severity: kind === 'bug' ? severity : '', started: kind === 'bug' ? started : '', diagnostics: d } });
      toast(`Request #${r.id} sent. We’ll reply by email.`);
      setTitle(''); setBody(''); setStarted(''); tickets.reload();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const statusKind = (s: string) => (s === 'Fixed' ? 'ok' : s === 'Planned' ? 'gold' : s === 'In review' ? 'accent' : 'warn');
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      <Card title="New request" sub={admin ? 'Priority support on paid plans: we reply within one business day.' : 'We reply by email within one business day.'} style={{ flex: '3 1 520px' }}>
        {err && <div className="banner banner-no">{err}</div>}
        <div role="radiogroup" aria-label="Request type" className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          {KINDS.map((x) => (
            <button key={x.k} type="button" role="radio" aria-checked={kind === x.k} onClick={() => setKind(x.k)}
              style={{ textAlign: 'left', cursor: 'pointer', padding: 18, borderRadius: 16, border: `2px solid ${kind === x.k ? 'var(--accent)' : 'var(--border)'}`, background: kind === x.k ? 'var(--accent-soft)' : 'var(--surface)', color: 'var(--text)', display: 'flex', flexDirection: 'column', gap: 6, minHeight: 96 }}>
              <b style={{ fontSize: 16 }}>{x.title}</b><span className="text2" style={{ fontSize: 13 }}>{x.body}</span>
            </button>
          ))}
        </div>
        <Field label="Title" id="sp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === 'bug' ? 'Codex sessions not showing after update' : kind === 'feature' ? 'A weekly goal for active time' : 'Can my admin see my project names?'} />
        <div className="field"><label htmlFor="sp-body">{kind === 'bug' ? 'What happened, and what did you expect?' : kind === 'feature' ? 'What would you like, and why?' : 'Your question'}</label>
          <textarea id="sp-body" className="input" rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></div>
        {kind === 'bug' && (
          <div className="grid form-2col">
            <div className="field"><label htmlFor="sp-sev">How much does it affect you?</label><select id="sp-sev" className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}><option>Minor annoyance</option><option>Numbers look wrong</option><option>I can’t use the app</option></select></div>
            <Field label="When did it start?" id="sp-when" value={started} onChange={(e) => setStarted(e.target.value)} placeholder="Today, after the Codex update" />
          </div>
        )}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 14, background: 'var(--inset)', cursor: 'pointer' }}>
          <input type="checkbox" checked={diag} onChange={(e) => setDiag(e.target.checked)} style={{ width: 20, height: 20, margin: 0, accentColor: 'var(--accent)' }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><b>Include diagnostics</b><span className="text2" style={{ fontSize: 14 }}>App version, operating system, and sync status. Never code or prompts.</span></span>
        </label>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" disabled={busy || !title.trim() || !body.trim()} onClick={submit}>{busy ? 'Sending…' : kind === 'bug' ? 'Send bug report' : kind === 'feature' ? 'Send feature request' : 'Send question'}</button></div>
      </Card>
      <div className="col" style={{ flex: '2 1 340px', minWidth: 0 }}>
        <Card title="Your requests">
          {(tickets.data ?? []).length === 0 ? <Empty title="No requests yet" body="Anything you send appears here with its status." /> :
            tickets.data.map((t: any) => (
              <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 14, borderRadius: 14, border: '1px solid var(--border)' }}>
                <div className="between"><span className="mono muted" style={{ fontSize: 12 }}>#{t.id} · {t.kind}</span><Pill kind={statusKind(t.status) as any}>{t.status}</Pill></div>
                <b style={{ fontSize: 14 }}>{t.title}</b><span className="muted" style={{ fontSize: 12 }}>Opened {date(t.createdAt)}</span>
              </div>
            ))}
        </Card>
        <Card title="Quick help">
          {(admin ? ['Invite and remove members', 'How budgets and alerts work', 'Refreshing data from the database', 'Billing and invoices'] : ['Why are my Codex numbers low?', 'How active time is calculated', 'What force sync does', 'Resetting your password']).map((l) => (
            <a key={l} href={`https://aknologia.com/docs#${l.toLowerCase().replace(/[^a-z]+/g, '-')}`} target="_blank" rel="noreferrer" className="between" style={{ minHeight: 44, fontWeight: 700, color: 'var(--text)', textDecoration: 'none', borderBottom: '1px solid var(--border)' }}>{l}<Icon name="arrow" size={16} /></a>
          ))}
          <span className="muted" style={{ fontSize: 13 }}>Prefer email? support@aknologia.com</span>
        </Card>
      </div>
    </div>
  );
}
