import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAsync } from '../../shared/hooks';
import { Card, Empty, Field, Meter, SwitchRow, budgetColor } from '../../shared/ui';
import { Icon } from '../../shared/icons';
import { date, usd } from '../../shared/format';
import type { Ctx } from '../main';

export default function Budgets({ ctx }: { ctx: Ctx }) {
  const { data, error, setData } = useAsync(() => api('/admin/budgets'), [ctx.refreshKey]);
  const [def, setDef] = useState('');
  const [rules, setRules] = useState({ alert80: true, alert100: true, weeklySummary: true, emailMemberAt100: false });
  const [inboxes, setInboxes] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    setDef(String(data.defaultBudget));
    setRules({ alert80: data.alert80, alert100: data.alert100, weeklySummary: data.weeklySummary, emailMemberAt100: data.emailMemberAt100 });
    setInboxes(data.inboxes ?? []);
    setEdits({});
  }, [data]);
  if (error) return <div className="banner banner-no">{error}</div>;
  if (!data) return <Card><span className="muted">Loading budgets…</span></Card>;
  const save = async () => {
    setBusy(true);
    const members: Record<string, number | null> = {};
    Object.entries(edits).forEach(([id, v]) => (members[id] = v.trim() === '' ? null : parseFloat(v)));
    try { setData(await api('/admin/budgets', { method: 'PUT', body: { defaultBudget: parseFloat(def) || 0, ...rules, inboxes, members } })); ctx.toast('Budgets saved'); }
    catch (e: any) { ctx.toast(e.message); } finally { setBusy(false); }
  };
  const addInbox = () => { const e = draft.trim().toLowerCase(); if (e.includes('@')) setInboxes([...new Set([...inboxes, e])]); setDraft(''); };
  return (
    <>
      <div className="banner banner-gold">
        <span style={{ color: 'var(--gold)' }}><Icon name="info" size={22} /></span>
        <span style={{ flex: '1 1 420px', fontSize: 15 }}><b style={{ display: 'inline', color: 'var(--gold-ink)' }}>Budgets alert, they don’t block. </b>Claude Code and Codex keep working after a budget is reached. Alert inboxes get an email and the member gets a desktop notification.</span>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
      <div className="row">
        <Card title="Team default" style={{ flex: '1 1 380px' }}>
          <Field label="Monthly budget per member (USD)" id="def-budget" inputMode="decimal" className="input mono" value={def} onChange={(e) => setDef(e.target.value.replace(/[^\d.]/g, ''))} hint={`Applies to members without a custom budget. ${data.customCount} have a custom budget.`} />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
            <div style={{ background: 'var(--inset)', borderRadius: 14, padding: 14 }}><span className="muted" style={{ fontSize: 12 }}>Total budgets</span><div className="mono" style={{ fontSize: 22 }}>{usd(data.totalBudget, 0)}</div></div>
            <div style={{ background: 'var(--inset)', borderRadius: 14, padding: 14 }}><span className="muted" style={{ fontSize: 12 }}>Projected this month</span><div className="mono" style={{ fontSize: 22, color: data.projected > data.totalBudget ? 'var(--red)' : 'var(--text)' }}>{usd(data.projected, 0)}</div></div>
          </div>
          {data.totalBudget > 0 && data.projected > data.totalBudget && <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--red)' }}>At this pace the team will spend about {(data.projected / data.totalBudget).toFixed(1)}× its total budget this month.</span>}
        </Card>
        <Card title="When to alert" style={{ flex: '1 1 420px' }}>
          <div>
            <SwitchRow id="r80" label="At 80% of budget" desc="Early warning to alert inboxes and the member’s desktop." checked={rules.alert80} onChange={(v) => setRules({ ...rules, alert80: v })} />
            <SwitchRow id="r100" label="At 100% of budget" desc="Email to alert inboxes and a desktop notification to the member." checked={rules.alert100} onChange={(v) => setRules({ ...rules, alert100: v })} />
            <SwitchRow id="rw" label="Weekly summary" desc="Monday email with team spend and anyone over budget." checked={rules.weeklySummary} onChange={(v) => setRules({ ...rules, weeklySummary: v })} />
            <SwitchRow id="rm" label="Also email the member at 100%" desc="In addition to the desktop notification." checked={rules.emailMemberAt100} onChange={(v) => setRules({ ...rules, emailMemberAt100: v })} />
          </div>
          <div className="field">
            <span className="lbl">Alert inboxes</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {inboxes.map((e) => <span key={e} className="pill pill-accent" style={{ fontSize: 13 }}>{e}<button aria-label={`Remove ${e}`} onClick={() => setInboxes(inboxes.filter((x) => x !== e))} style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}><Icon name="x" size={12} /></button></span>)}
              {inboxes.length === 0 && <span className="muted" style={{ fontSize: 13 }}>No inboxes: all admins get alerts.</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}><input className="input" aria-label="Add an alert inbox" placeholder="finance@yourco.com" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addInbox()} /><button className="btn btn-secondary" onClick={addInbox}>Add</button></div>
          </div>
        </Card>
      </div>
      <Card title="Member budgets" sub="Type a value to set a custom budget. Clear it to use the team default. Save to apply.">
        <div className="table-wrap"><table className="t" style={{ minWidth: 860 }}>
          <thead><tr><th>Member</th><th>Budget</th><th style={{ width: 280 }}>Used this month</th><th className="r">Projected</th><th>Alerts sent</th></tr></thead>
          <tbody>{data.members.map((m: any) => (
            <tr key={m.id}>
              <td><b>{m.name}</b></td>
              <td><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input className="input mono" aria-label={`Budget for ${m.name}`} inputMode="decimal" style={{ width: 100, minHeight: 40 }} placeholder={String(data.defaultBudget)}
                  value={edits[m.id] ?? (m.custom ? String(m.budget) : '')} onChange={(e) => setEdits({ ...edits, [m.id]: e.target.value.replace(/[^\d.]/g, '') })} />
                <span className="muted" style={{ fontSize: 12 }}>{(edits[m.id] ?? (m.custom ? 'x' : '')) ? 'Custom' : 'Default'}</span></span></td>
              <td><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ flex: 1 }}><Meter pct={m.pct} color={budgetColor(m.pct)} /></div><span className="mono" style={{ fontSize: 12, minWidth: 100, textAlign: 'right', color: m.pct >= 100 ? 'var(--red)' : 'var(--text2)' }}>{usd(m.spent)} · {m.pct}%</span></div></td>
              <td className="r mono" style={{ color: m.projected > m.budget ? 'var(--red)' : 'var(--text2)' }}>{usd(m.projected, 0)}</td>
              <td className="text2" style={{ fontSize: 13 }}>{m.alerts?.length ? m.alerts.join(', ') : 'None yet'}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      <Card title="Alert log" sub="Every budget email and notification we sent">
        {data.log.length === 0 ? <Empty title="No alerts yet" body="Alerts appear here when someone crosses 80% or 100% of their budget." /> : data.log.map((l: any, i: number) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr) minmax(0,1fr)', gap: 12, alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--border)', fontSize: 14 }}>
            <span className="mono text2" style={{ fontSize: 13 }}>{date(l.at)}</span>
            <b style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: l.threshold >= 100 ? 'var(--red)' : 'var(--amber)' }} />{l.name} reached {l.threshold}%</b>
            <span className="text2">Emailed {l.sentTo || 'admins'}</span>
          </div>
        ))}
      </Card>
    </>
  );
}
