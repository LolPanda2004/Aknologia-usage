import { useState } from 'react';
import { api } from '../api';
import { useAsync } from '../../shared/hooks';
import { Card, Field, Kpi, Modal, Pill, Skeleton, TableScroll } from '../../shared/ui';
import { Icon } from '../../shared/icons';
import { date, usd } from '../../shared/format';
import type { Ctx } from '../main';

type Filter = 'all' | 'active' | 'invited' | 'removed';

export default function Members({ ctx }: { ctx: Ctx }) {
  const { data, error, reload } = useAsync(() => api('/admin/members'), [ctx.refreshKey]);
  const [filter, setFilter] = useState<Filter>('all');
  const [invite, setInvite] = useState(false);
  const [remove, setRemove] = useState<any>(null);
  const [budget, setBudget] = useState<any>(null);
  if (error) return <div className="banner banner-no">{error}</div>;
  if (!data) return <Skeleton label="Loading members…" chart={false} />;
  const rows = data.members.filter((m: any) => filter === 'all' || m.status === filter);
  const count = (s: string) => data.members.filter((m: any) => m.status === s).length;
  const act = async (fn: () => Promise<any>, msg: string) => { try { await fn(); ctx.toast(msg); reload(); } catch (e: any) { ctx.toast(e.message); } };
  return (
    <>
      <div className="grid g4">
        <Kpi variant="gold" label="Seats used" value={`${data.used} of ${data.seats}`} sub={`${count('active')} active · ${data.invited} invite${data.invited === 1 ? '' : 's'} pending`} />
        <Kpi label="Active this week" value={data.activeWeek} sub="Used a tool in the last 7 days" />
        <Kpi label="Pending invites" value={data.invited} sub="Invites expire after 14 days" />
        <Kpi label="Removed this month" value={data.removedThisMonth} sub="Usage history kept" />
      </div>
      <div className="banner" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <span style={{ color: 'var(--gold)' }}><Icon name="mail" size={20} /></span>
        <span className="text2" style={{ flex: '1 1 420px', fontSize: 14 }}>Members get an email when you invite or remove them. New members install the desktop app and set a password with the invite code. Removing someone stops tracking at their next sync; their past usage stays in reports.</span>
        <button className="btn btn-primary" onClick={() => setInvite(true)}><Icon name="users" size={16} />Invite members</button>
      </div>
      <Card>
        <div className="row" role="group" aria-label="Filter members" style={{ gap: 8 }}>
          {(['all', 'active', 'invited', 'removed'] as Filter[]).map((f) => (
            <button key={f} className={'btn btn-sm ' + (filter === f ? 'btn-primary' : 'btn-secondary')} style={{ borderRadius: 999 }} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f[0].toUpperCase() + f.slice(1)} · {f === 'all' ? data.members.length : count(f)}
            </button>
          ))}
        </div>
        <TableScroll label="Members" sticky>
          <table className="t t-cards" role="table" style={{ '--min': '940px' } as React.CSSProperties}>
            <thead role="rowgroup"><tr role="row"><th role="columnheader">Member</th><th role="columnheader">Role</th><th role="columnheader">Status</th><th role="columnheader" className="r">Monthly budget</th><th role="columnheader">Devices</th><th role="columnheader">Since</th><th role="columnheader" className="r">Actions</th></tr></thead>
            <tbody role="rowgroup">
              {rows.map((m: any) => (
                <tr key={m.id} role="row">
                  <td role="cell" className="c-main"><a href={m.status === 'invited' ? undefined : `#/members/${m.id}`} className="t-link" style={{ color: m.status === 'removed' ? 'var(--muted)' : 'var(--text)' }}><span className="avatar">{m.initials}</span><span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><b>{m.name}{m.self ? ' (you)' : ''}</b><span className="muted" style={{ fontSize: 12 }}>{m.email}</span></span></a></td>
                  <td role="cell" data-label="Role" className="text2">{m.role === 'admin' ? 'Admin' : 'Member'}</td>
                  <td role="cell" data-label="Status"><Pill kind={m.status === 'active' ? 'ok' : m.status === 'invited' ? 'warn' : 'neutral'}>{m.status === 'active' ? 'Active' : m.status === 'invited' ? 'Invite pending' : 'Removed'}</Pill></td>
                  <td role="cell" data-label="Monthly budget" className="r mono">{m.status === 'removed' ? '—' : usd(m.budget, 0)}{m.customBudget && m.status !== 'removed' ? <span className="muted" style={{ fontSize: 11 }}> custom</span> : null}</td>
                  <td role="cell" data-label="Devices" className="text2" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{m.devices?.length ? `${m.devices.length} · ${m.devices.join(', ')}` : '—'}</td>
                  <td role="cell" data-label="Since" className="text2" style={{ fontSize: 13 }}>{m.status === 'invited' ? `Expires ${date(m.inviteExpires)}` : m.status === 'removed' ? `Removed ${date(m.removedAt)}` : date(m.since)}</td>
                  <td role="cell" className="r c-actions"><span className="row-actions">
                    {m.status === 'active' && <><button className="btn btn-secondary btn-sm" onClick={() => setBudget(m)}>Edit budget</button>{!m.self && <button className="btn btn-danger-outline btn-sm" onClick={() => setRemove(m)}>Remove</button>}</>}
                    {m.status === 'invited' && <><button className="btn btn-secondary btn-sm" onClick={() => act(() => api(`/admin/members/${m.id}/resend`, { body: {} }), `Invite resent to ${m.email}`)}>Resend invite</button><button className="btn btn-danger-outline btn-sm" onClick={() => act(() => api(`/admin/members/${m.id}`, { method: 'DELETE' }), 'Invite cancelled')}>Cancel invite</button></>}
                    {m.status === 'removed' && <button className="btn btn-secondary btn-sm" onClick={() => act(() => api('/admin/members/invite', { body: { emails: [m.email], role: m.role } }), `Re-invited ${m.email}`)}>Re-invite</button>}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>
      {invite && <InviteModal seatsLeft={data.seats - data.used} onClose={() => setInvite(false)} onDone={(msg) => { setInvite(false); ctx.toast(msg); reload(); }} />}
      {remove && <RemoveModal m={remove} onClose={() => setRemove(null)} onDone={(msg) => { setRemove(null); ctx.toast(msg); reload(); }} />}
      {budget && <BudgetModal m={budget} onClose={() => setBudget(null)} onDone={(msg) => { setBudget(null); ctx.toast(msg); reload(); }} />}
    </>
  );
}

function InviteModal({ seatsLeft, onClose, onDone }: { seatsLeft: number; onClose: () => void; onDone: (m: string) => void }) {
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [role, setRole] = useState('member');
  const [budget, setBudget] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const add = (s: string) => {
    const parts = s.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.includes('@'));
    if (parts.length) setEmails((e) => [...new Set([...e, ...parts])]);
    setDraft('');
  };
  const send = async () => {
    const list = draft ? [...emails, ...draft.split(/[\s,;]+/).filter((x) => x.includes('@'))] : emails;
    setBusy(true); setErr('');
    try {
      const r = await api('/admin/members/invite', { body: { emails: list, role, budgetCents: budget ? Math.round(parseFloat(budget) * 100) : null } });
      const sent = r.results.filter((x: any) => x.result === 'invited').length;
      const other = r.results.filter((x: any) => x.result !== 'invited').map((x: any) => `${x.email} (${x.result.replace(/_/g, ' ')})`);
      onDone(`${sent} invite${sent === 1 ? '' : 's'} sent${other.length ? '. Skipped: ' + other.join(', ') : ''}`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Invite members" onClose={onClose}>
      <span className="text2">Each person gets an email with an invite code, the download link, and a plain list of what is and isn’t tracked.</span>
      {err && <div className="banner banner-no">{err}</div>}
      <div className="field">
        <label htmlFor="inv-emails">Work emails</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 10, borderRadius: 14, border: '1px solid var(--border-strong)', background: 'var(--inset)' }}>
          {emails.map((e) => <span key={e} className="pill pill-accent" style={{ fontSize: 13 }}>{e}<button aria-label={`Remove ${e}`} onClick={() => setEmails(emails.filter((x) => x !== e))} style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}><Icon name="x" size={12} /></button></span>)}
          <input id="inv-emails" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (['Enter', ',', ' '].includes(e.key)) { e.preventDefault(); add(draft); } }} onBlur={() => draft && add(draft)} onPaste={(e) => { e.preventDefault(); add(e.clipboardData.getData('text')); }}
            placeholder="name@yourco.com" style={{ flex: '1 1 160px', minHeight: 36, border: 'none', background: 'transparent', outline: 'none' }} />
        </div>
        <span className="hint">Separate with commas or paste a list. {seatsLeft} seat{seatsLeft === 1 ? '' : 's'} left.</span>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 14 }}>
        <div className="field"><label htmlFor="inv-role">Role</label><select id="inv-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}><option value="member">Member</option><option value="admin">Admin</option></select></div>
        <Field label="Monthly budget (USD)" id="inv-budget" inputMode="decimal" placeholder="Team default" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ''))} hint="Leave empty to use the team default" />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy || (emails.length === 0 && !draft.includes('@'))} onClick={send}><Icon name="mail" size={16} />{busy ? 'Sending…' : `Send ${Math.max(emails.length, draft.includes('@') ? 1 : 0)} invite${emails.length === 1 ? '' : 's'}`}</button></div>
    </Modal>
  );
}

function RemoveModal({ m, onClose, onDone }: { m: any; onClose: () => void; onDone: (msg: string) => void }) {
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true);
    try { await api(`/admin/members/${m.id}?deleteHistory=${history}`, { method: 'DELETE' }); onDone(`${m.name} was removed and emailed`); } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  return (
    <Modal title={`Remove ${m.name}?`} onClose={onClose} alert>
      {err && <div className="banner banner-no">{err}</div>}
      <ol className="text2" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <li>Tracking stops on their devices at the next sync.</li>
        <li>They get an email saying they were removed and can uninstall the app.</li>
        <li>Their password stops working and the seat frees up. You can re-invite them later.</li>
      </ol>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 14, background: 'var(--inset)', cursor: 'pointer' }}>
        <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} style={{ width: 20, height: 20, margin: 0, accentColor: 'var(--danger)' }} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><b>Also delete their usage history</b><span className="text2" style={{ fontSize: 13 }}>Off by default. Past team totals will drop by their share.</span></span>
      </label>
      <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}><button className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-danger" disabled={busy} onClick={go}>{busy ? 'Removing…' : `Remove and email ${m.name.split(' ')[0]}`}</button></div>
    </Modal>
  );
}

function BudgetModal({ m, onClose, onDone }: { m: any; onClose: () => void; onDone: (msg: string) => void }) {
  const [v, setV] = useState(m.customBudget ? String(m.budget) : '');
  const save = async (val: number | null) => {
    try { await api(`/admin/members/${m.id}`, { method: 'PATCH', body: { budgetCents: val == null ? null : Math.round(val * 100) } }); onDone(`Budget updated for ${m.name}`); } catch (e: any) { onDone(e.message); }
  };
  return (
    <Modal title={`Monthly budget for ${m.name}`} onClose={onClose}>
      <Field label="Budget (USD per month)" id="mb-v" inputMode="decimal" value={v} placeholder="Team default" onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, ''))} hint="Alerts go out at 80% and 100%. Changing the budget resets this month’s alerts." />
      <div className="row" style={{ justifyContent: 'flex-end', gap: 10 }}><button className="btn btn-ghost" onClick={() => save(null)}>Use team default</button><button className="btn btn-primary" disabled={!v} onClick={() => save(parseFloat(v))}>Save budget</button></div>
    </Modal>
  );
}
