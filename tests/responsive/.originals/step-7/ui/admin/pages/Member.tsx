import { api } from '../api';
import { useAsync } from '../../shared/hooks';
import { Card, Empty, Kpi, Meter, Pill, ShareRows, StackedBars, TableScroll, budgetColor } from '../../shared/ui';
import { Icon } from '../../shared/icons';
import { ago, date, mins, usd, when } from '../../shared/format';
import type { Ctx } from '../main';

export default function Member({ id, ctx }: { id: string; ctx: Ctx }) {
  const { data: d, error } = useAsync(() => api(`/admin/members/${id}/usage`), [id, ctx.refreshKey]);
  if (error) return <div className="banner banner-no">{error}</div>;
  if (!d) return <Card><span className="muted">Loading member…</span></Card>;
  const b = d.budget, k = d.kpis, m = d.member;
  const pct = b.pct as number;
  const daily = d.daily.map((x: any) => ({ label: x.day.slice(8), claude: x.claude, codex: x.codex }));
  return (
    <>
      <button className="btn btn-ghost" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={() => ctx.go('/members')}><Icon name="back" size={16} />Back to members</button>
      <div className="between">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="avatar avatar-gold" style={{ width: 60, height: 60, fontSize: 20 }}>{m.initials}</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}><span style={{ fontSize: 26, fontWeight: 800 }}>{m.name}</span>
              <Pill kind={pct >= 100 ? 'no' : pct >= 80 ? 'warn' : 'ok'}>{pct >= 100 ? 'Over budget' : pct >= 80 ? 'Near budget' : 'On track'}</Pill></div>
            <span className="text2" style={{ fontSize: 14 }}>{m.email} · {m.role === 'admin' ? 'Admin' : 'Member'} since {date(m.since)} · last active {ago(m.lastActive)}</span>
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => ctx.go('/budgets')}><Icon name="wallet" size={16} />Change budget</button>
      </div>
      <Card title={`${b.month} budget`} sub={`${usd(b.budgetCents / 100, 0)} per month · ${b.custom ? 'custom for this member' : 'team default'} · resets ${date(b.resetsOn)}`}
        right={<span className="mono" style={{ fontSize: 26, color: pct >= 100 ? 'var(--red)' : 'var(--text)' }}>{usd(b.spentCents / 100)} <span className="muted" style={{ fontSize: 16 }}>of {usd(b.budgetCents / 100, 0)} · {pct}%</span></span>}
        style={pct >= 100 ? { borderColor: 'var(--no-line)' } : undefined}>
        <Meter pct={pct} color={budgetColor(pct)} />
        <span className="text2" style={{ fontSize: 14 }}>Projected {usd(b.projectedCents / 100, 0)} by month end.{d.alerts.length > 0 && ' Alerts sent: ' + d.alerts.map((a: any) => `${a.threshold}% on ${date(a.at)}`).join(', ') + '.'}</span>
      </Card>
      <div className="row">
        <Kpi label="Active coding time" value={k.activeHours + ' h'} sub={`Team average ${k.teamActiveHours} h`} />
        <Kpi label="Spend" value={usd(k.spend)} sub={`Team average ${usd(k.teamSpend)}`} />
        <Kpi label="Cost per active hour" value={usd(k.costPerHour)} sub={`Team average ${usd(k.teamCostPerHour)}`} />
        <Kpi label="Sessions" value={k.sessions} sub="This month" />
        <Kpi label="Served from cache" value={k.cacheShare + '%'} sub={`Team ${k.teamCacheShare}%`} />
      </div>
      <div className="row">
        <Card title="Daily spend" sub="API-equivalent, USD" style={{ flex: '2 1 480px' }} right={<span className="legend"><span><i style={{ background: 'var(--s1)' }} />Claude Code</span><span><i style={{ background: 'var(--s2)' }} />Codex</span></span>}>
          <StackedBars data={daily} />
        </Card>
        <Card title="Spend by model" sub="Team share in brackets" style={{ flex: '1 1 360px' }}>
          {d.models.length === 0 ? <Empty title="No usage this month" body="Nothing has synced from this member yet." /> :
            <ShareRows rows={d.models.map((x: any) => ({ name: x.model, share: x.share, right: `${x.share}% (${x.teamShare}%) · ${usd(x.cost)}`, color: x.tool === 'codex' ? 'var(--s2)' : 'var(--s1)' }))} />}
        </Card>
      </div>
      <div className="row">
        <Card title="Recent sessions" sub="Projects are hashed. Prompts, code, and file names are never collected." style={{ flex: '2 1 480px' }}>
          <TableScroll label="Recent sessions" sticky><table className="t" style={{ '--min': '540px' } as React.CSSProperties}>
            <thead><tr><th>Started</th><th>Project</th><th>Model</th><th className="r">Active</th><th className="r">Cost</th></tr></thead>
            <tbody>{d.sessions.map((s: any, i: number) => <tr key={i}><td className="text2">{when(s.started)}</td><td className="mono" style={{ fontSize: 13 }}>{s.project || '—'}</td><td className="text2" style={{ fontSize: 13 }}>{s.model || s.tool}</td><td className="r mono">{mins(s.activeMinutes)}</td><td className="r mono">{usd(s.cost)}</td></tr>)}</tbody>
          </table></TableScroll>
        </Card>
        <Card title="Devices" style={{ flex: '1 1 320px' }}>
          {d.devices.length === 0 ? <Empty title="No devices" body="This member hasn’t signed in on the desktop app yet." /> : d.devices.map((x: any, i: number) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 14, borderRadius: 14, background: 'var(--inset)' }}>
              <div className="between"><b style={{ fontSize: 14 }}>{x.name} · {x.os}</b><Pill kind={x.lastSync ? 'ok' : 'neutral'}>{x.lastSync ? 'Synced ' + ago(x.lastSync) : 'Never synced'}</Pill></div>
              <span className="text2" style={{ fontSize: 13 }}>App {x.appVersion || 'unknown'} · {x.unreadLines} unread lines</span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
