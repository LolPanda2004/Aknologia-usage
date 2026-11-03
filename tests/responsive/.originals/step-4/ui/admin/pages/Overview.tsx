import { useEffect, useState } from 'react';
import { api, download } from '../api';
import { useAsync } from '../../shared/hooks';
import { Card, Empty, InfoTip, Kpi, Meter, Pill, Segmented, ShareRows, TableScroll, budgetColor } from '../../shared/ui';
import { Icon } from '../../shared/icons';
import { ago, usd } from '../../shared/format';
import type { Ctx } from '../main';

function monthKey(offset: number) {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function SpendLine({ daily, budgets, days }: { daily: { day: string; claude: number; codex: number }[]; budgets: number; days: number }) {
  let run = 0;
  const pts = daily.map((d) => (run += d.claude + d.codex));
  const pace = daily.map((_, i) => (budgets / days) * (i + 1));
  const max = Math.max(1, ...pts, ...pace);
  const W = 600, H = 200, n = Math.max(1, pts.length - 1);
  const xy = (v: number, i: number) => `${((i / n) * W).toFixed(1)} ${(H - 12 - (v / max) * (H - 24)).toFixed(1)}`;
  const line = pts.map((v, i) => (i ? 'L' : 'M') + xy(v, i)).join(' ');
  const paceLine = pace.map((v, i) => (i ? 'L' : 'M') + xy(v, i)).join(' ');
  const last = pts[pts.length - 1] ?? 0;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 220, display: 'block' }} role="img" aria-label={`Cumulative spend ${usd(last)}; budget pace ${usd(pace[pace.length - 1] ?? 0)}`}>
        {[50, 100, 150].map((y) => <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="var(--border)" />)}
        {pts.length > 0 && <path d={line + ` L${W} ${H} L0 ${H} Z`} fill="var(--s1-soft)" />}
        <path d={paceLine} fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeDasharray="7 6" />
        <path d={line} fill="none" stroke="var(--s1)" strokeWidth="3" strokeLinejoin="round" />
      </svg>
      <div className="between muted" style={{ fontSize: 12 }}>{daily.length > 0 && <><span>{daily[0].day.slice(5)}</span><span>{daily[Math.floor(daily.length / 2)]?.day.slice(5)}</span><span>{daily[daily.length - 1].day.slice(5)}</span></>}</div>
    </>
  );
}

export default function Overview({ ctx, onRefreshedAt }: { ctx: Ctx; onRefreshedAt: (t: string | null) => void }) {
  const [month, setMonth] = useState<'this' | 'last'>('this');
  const { data: d, error, loading } = useAsync(() => api(`/admin/overview?month=${monthKey(month === 'this' ? 0 : -1)}`), [month, ctx.refreshKey]);
  useEffect(() => { if (d) onRefreshedAt(d.refreshedAt); }, [d, onRefreshedAt]);
  const toolbar = (
    <div className="between">
      <Segmented label="Month" value={month} onChange={setMonth} options={[{ value: 'this', label: 'This month' }, { value: 'last', label: 'Last month' }]} />
      <div className="row" style={{ gap: 10 }}>
        <button className="btn btn-secondary" onClick={() => ctx.go('/members')}><Icon name="users" size={16} />Invite members</button>
        <button className="btn btn-secondary" onClick={() => download(`/admin/export.csv`, 'aknologia-usage.csv').catch((e) => ctx.toast(e.message))}><Icon name="ext" size={16} />Export CSV</button>
      </div>
    </div>
  );
  if (error) return <>{toolbar}<div className="banner banner-no">{error}</div></>;
  if (loading || !d) return <>{toolbar}<Card><span className="muted">Loading team usage…</span></Card></>;
  const k = d.kpis;
  const delta = k.prevCostPerHour ? k.costPerHour - k.prevCostPerHour : 0;
  return (
    <>
      {toolbar}
      {(d.alerts.over.length > 0 || d.alerts.near.length > 0) && (
        <div className="banner banner-no" role="status" data-tour="alerts">
          <Icon name="alert" size={22} />
          <div style={{ flex: '1 1 380px' }}><b>{d.alerts.over.length} over budget and {d.alerts.near.length} close</b>
            <span style={{ fontSize: 14 }}>{d.alerts.over.length > 0 && <>Over: {d.alerts.over.join(', ')}. </>}{d.alerts.near.length > 0 && <>Close: {d.alerts.near.join(', ')}. </>}Alert emails went to your alert inboxes.</span></div>
          <button className="btn btn-danger" onClick={() => ctx.go('/budgets')}>Review budgets</button>
        </div>
      )}
      {d.alerts.over.length === 0 && d.alerts.near.length === 0 && <div className="banner banner-ok" data-tour="alerts"><Icon name="check" stroke={3} />Everyone is under 80% of their budget.</div>}
      <div className="row" data-tour="kpis">
        <Kpi variant="gold" label="Team spend" tip="API-equivalent cost at public list prices. Subscriptions bill differently." value={usd(k.spend)} sub={`${k.budgets ? Math.round((k.spend / k.budgets) * 100) : 0}% of ${usd(k.budgets, 0)} in budgets · projected ${usd(k.projected, 0)}`} />
        <Kpi label="Active coding time" tip="Session time where turns are under 5 minutes apart. Idle time is removed." value={k.activeHours + ' h'} sub={k.activeMembers ? `${(k.activeHours / k.activeMembers).toFixed(1)} h per active member` : 'No activity yet'} />
        <Kpi label="Cost per active hour" tip="Spend divided by active time." value={usd(k.costPerHour)} sub={k.prevCostPerHour ? `${delta <= 0 ? '↓' : '↑'} ${usd(Math.abs(delta))} vs last month` : 'No previous month yet'} />
        <Kpi label="Active members" tip="Members with any usage in this period." value={`${k.activeMembers} of ${k.members}`} sub={`${k.pendingInvites} invite${k.pendingInvites === 1 ? '' : 's'} pending`} />
        <Kpi label="Saved by caching" tip="What cached input would have cost as normal input, minus what it did cost." value={usd(k.saved, 0)} sub={`${k.cacheShare}% of input from cache`} />
      </div>
      <div className="row">
        <Card title="Spend this month" sub="Cumulative, with the even pace to your total budget" style={{ flex: '2 1 520px' }}
          right={<span className="legend"><span><i style={{ background: 'var(--s1)' }} />Actual</span><span><i style={{ background: 'var(--gold)' }} />Budget pace</span></span>}>
          <SpendLine daily={d.daily} budgets={k.budgets} days={d.range.days} />
          <span className="text2" style={{ fontSize: 14 }}>At this pace the team reaches about {usd(k.projected, 0)} by month end{k.budgets && k.projected / k.budgets >= 0.5 ? `, ${(k.projected / k.budgets).toFixed(1)}× its total budget` : ''}.</span>
        </Card>
        <Card title="Budget health" sub={`${k.members} members`} style={{ flex: '1 1 320px' }}>
          {[['Over budget', d.budgetHealth.over, 'var(--red)'], ['80% or more', d.budgetHealth.near, 'var(--amber)'], ['Under 80%', d.budgetHealth.under, 'var(--s1)'], ['Not started', d.budgetHealth.notStarted, 'var(--raised)']].map(([l, n, c]) => (
            <div key={l as string} className="between" style={{ fontSize: 14 }}><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: c as string, display: 'inline-block' }} />{l}</span><span className="mono">{n as number}</span></div>
          ))}
        </Card>
      </div>
      <div className="row">
        <Card title="Cost per active hour" sub={`Team average ${usd(k.costPerHour)}`} style={{ flex: '1 1 420px' }}>
          {d.costPerHour.length === 0 ? <Empty title="Not enough data yet" body="Members need at least an hour of active time." /> :
            d.costPerHour.map((c: any) => (
              <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '140px minmax(0,1fr) 64px', gap: 12, alignItems: 'center', fontSize: 14 }}>
                <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                <Meter pct={(c.value / Math.max(...d.costPerHour.map((x: any) => x.value))) * 100} color={c.value > k.costPerHour * 1.3 ? 'var(--red)' : c.value > k.costPerHour ? 'var(--amber)' : 'var(--s1)'} tick={false} />
                <span className="mono" style={{ textAlign: 'right' }}>{usd(c.value)}</span>
              </div>
            ))}
          <span className="muted" style={{ fontSize: 13 }}>A high rate usually means heavier use of large models or long generated outputs, not more work.</span>
        </Card>
        <Card title="Spend by model" sub={`Share of ${usd(k.spend)}`} style={{ flex: '1 1 420px' }}>
          {d.models.length === 0 ? <Empty title="No usage yet" body="Numbers appear after members’ first hourly sync." /> :
            <ShareRows rows={d.models.map((m: any) => ({ name: m.model, share: m.share, right: `${m.share}% · ${usd(m.cost)}`, color: m.tool === 'codex' ? 'var(--s2)' : 'var(--s1)' }))} />}
        </Card>
      </div>
      <Card title="Members" sub="Sorted by budget used · select a member for their full usage" right={<button className="btn btn-ghost" onClick={() => ctx.go('/members')}>Manage members</button>}>
        <TableScroll label="Members" sticky>
          <table className="t t-cards" role="table" style={{ '--min': '900px' } as React.CSSProperties}>
            <thead role="rowgroup"><tr role="row"><th role="columnheader">Member</th><th role="columnheader">Status</th><th role="columnheader" className="r">Active time</th><th role="columnheader" className="r">Spend</th><th role="columnheader" style={{ width: 220 }}>Budget used</th><th role="columnheader" style={{ width: 120 }}>Tool mix</th><th role="columnheader">Last active</th></tr></thead>
            <tbody role="rowgroup">
              {d.members.map((m: any) => (
                <tr key={m.id} role="row">
                  <td role="cell" className="c-main"><a href={`#/members/${m.id}`} className="t-link"><span className="avatar">{m.initials}</span><span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}><b>{m.name}</b><span className="muted" style={{ fontSize: 12 }}>{m.email}</span></span></a></td>
                  <td role="cell" data-label="Status"><Pill kind={m.status === 'Over budget' ? 'no' : m.status === 'Near budget' ? 'warn' : m.status === 'On track' ? 'ok' : 'neutral'}>{m.status}</Pill></td>
                  <td role="cell" data-label="Active time" className="r mono">{m.activeHours} h</td><td role="cell" data-label="Spend" className="r mono">{usd(m.spend)}</td>
                  <td role="cell" data-label="Budget used" className="c-full"><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><div style={{ flex: 1 }}><Meter pct={m.pct} color={budgetColor(m.pct)} tick={false} /></div><span className="mono" style={{ fontSize: 12, minWidth: 84, textAlign: 'right', color: m.pct >= 100 ? 'var(--red)' : 'var(--text2)' }}>{m.pct}% of {usd(m.budget, 0)}</span></div></td>
                  <td role="cell" data-label="Tool mix" title={`Claude Code ${m.claudeShare}%, Codex ${100 - m.claudeShare}%`}><div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, background: 'var(--raised)', width: 110, maxWidth: '100%' }}>{m.spend > 0 && <><div style={{ width: m.claudeShare + '%', background: 'var(--s1)' }} /><div style={{ flex: 1, background: 'var(--s2)' }} /></>}</div><span className="sr-only">Claude Code {m.claudeShare}%, Codex {100 - m.claudeShare}%</span></td>
                  <td role="cell" data-label="Last active" className="text2" style={{ fontSize: 13 }}>{m.memberStatus === 'invited' ? 'Invite pending' : ago(m.lastActive)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>
      <div className="row">
        <Card title="Daily active members" sub="Members who used a tool each day" style={{ flex: '1 1 340px' }}>
          {d.dailyActive.length === 0 ? <Empty title="No activity yet" body="Invite your team to start seeing usage." /> : (
            <div className="bars" style={{ height: 140 }}>
              {d.dailyActive.map((x: any) => <div className="b" key={x.day} title={`${x.day}: ${x.members}`}><span className="v">{x.members}</span><div className="stack"><div style={{ height: (x.members / Math.max(...d.dailyActive.map((y: any) => y.members))) * 100, background: 'var(--s1)', borderRadius: '6px 6px 2px 2px' }} /></div></div>)}
            </div>
          )}
        </Card>
        <Card title="Data health" style={{ flex: '1 1 340px' }} right={(d.dataHealth.outdated.length + d.dataHealth.unreadDevices) > 0 ? <Pill kind="warn">{d.dataHealth.outdated.length + d.dataHealth.unreadDevices} issues</Pill> : <Pill kind="ok">Healthy</Pill>}>
          <div className="banner" style={{ background: 'var(--inset)', padding: 14 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green)' }} /><span><b style={{ fontSize: 14 }}>{d.dataHealth.synced2h} of {d.dataHealth.devices} devices synced in the last 2 hours</b></span></div>
          {d.dataHealth.outdated.length > 0 && <div className="banner" style={{ background: 'var(--inset)', padding: 14 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--amber)' }} /><span><b style={{ fontSize: 14 }}>{d.dataHealth.outdated.length} devices on an old app version</b><span className="text2" style={{ fontSize: 13 }}>{d.dataHealth.outdated.join(', ')} should update to {d.dataHealth.minVersion}.</span></span></div>}
          {d.dataHealth.unreadLines > 0 && <div className="banner" style={{ background: 'var(--inset)', padding: 14 }}><span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--amber)' }} /><span><b style={{ fontSize: 14 }}>{d.dataHealth.unreadLines} lines unread on {d.dataHealth.unreadDevices} device(s)</b><span className="text2" style={{ fontSize: 13 }}>Usually a newer Claude Code or Codex version. Counted once the app updates.</span></span></div>}
        </Card>
        <Card title="How to read these numbers" style={{ flex: '1 1 340px' }}>
          {[['Spend', 'What the tokens would cost at public API prices. Treat it as a usage measure, not an invoice.'], ['Active coding time', 'Time in a session where turns are under 5 minutes apart.'], ['Cost per active hour', 'Spend divided by active time. Compare people doing similar work.'], ['Budget', 'A monthly limit per member. Crossing 80% or 100% emails you and notifies the member. Tools are never blocked.']].map(([t, b]) => (
            <div key={t} style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}><b style={{ fontSize: 14 }}>{t} <InfoTip text={b} /></b><span className="text2" style={{ fontSize: 13 }}>{b}</span></div>
          ))}
        </Card>
      </div>
    </>
  );
}
