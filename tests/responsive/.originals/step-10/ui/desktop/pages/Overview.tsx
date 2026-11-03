import { useState } from 'react';
import { agent } from '../api';
import { useAsync } from '../../shared/hooks';
import { Card, Donut, Empty, Heatmap, InfoTip, Kpi, Meter, Segmented, ShareRows, Skeleton, StackedBars, TableScroll, budgetColor } from '../../shared/ui';
import { Icon } from '../../shared/icons';
import { date, mins, num, usd, when } from '../../shared/format';
import type { DCtx } from '../main';

export default function Overview({ ctx }: { ctx: DCtx }) {
  const [days, setDays] = useState<'1' | '7' | '30'>('7');
  const { data: s } = useAsync(() => agent(`/summary?days=${days}`), [days, ctx.tick]);
  const b = ctx.status.budget;
  const pct = b?.pct ?? 0;
  const toolbar = <Segmented label="Date range" value={days} onChange={setDays} options={[{ value: '1', label: 'Today' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} />;
  if (!s) return <>{toolbar}<Skeleton label="Reading your usage…" /></>;
  const claudeShare = s.cost > 0 ? Math.round(((s.costByTool.claude_code ?? 0) / s.cost) * 100) : 0;
  const delta = s.activeHours - s.prevActiveHours;
  const empty = s.sessions === 0;
  return (
    <>
      <div className="between">{toolbar}<span className="muted" style={{ fontSize: 13 }}>Numbers are calculated on this device. Your admin sees the same totals after each sync.</span></div>
      {b && pct >= 100 && (
        <div className="banner banner-no" role="alert"><Icon name="alert" size={22} />
          <div style={{ flex: '1 1 360px' }}><b>You’ve reached the {usd(b.budgetCents / 100, 0)} monthly budget set by your admin</b><span style={{ fontSize: 14 }}>You’ve used {usd(b.spentCents / 100)} in {b.month}. Your admin has been emailed. Nothing is blocked, so you can keep working.</span></div>
          <button className="btn btn-danger" onClick={() => ctx.go('/support')}>Ask for a higher budget</button>
        </div>
      )}
      {empty && (
        <Card><Empty title="No AI coding activity yet" body="Use Claude Code or Codex as usual. This page fills in within a minute, and your admin sees it after the next hourly sync." action={<button className="btn btn-secondary" onClick={() => ctx.go('/settings')}>Check detected sources</button>} /></Card>
      )}
      <div className="row" data-tour="kpis">
        <Kpi variant="hero" label="Active coding time" tip="Time inside a session where turns are under 5 minutes apart. Idle time is removed." value={s.activeHours + ' h'}
          sub={`${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(1)} h vs the previous ${days === '1' ? 'day' : days + ' days'}${s.sessions ? ` · ${Math.round((s.activeHours * 60) / s.sessions)} min per session` : ''}`} />
        <Kpi label="Spend" tip="API-equivalent cost at public list prices." value={usd(s.cost)} sub={s.projectedMonth ? `On track for about ${usd(s.projectedMonth, 0)} this month` : 'This period'} />
        <Kpi label="Tokens" tip="Input, output, cache write, and cache read combined." value={num(s.tokens)} sub={`${s.cacheShare}% served from cache`} />
        <Kpi label="Sessions" tip="A session is one Claude Code or Codex conversation." value={s.sessions} sub={`${s.sessionsByTool.claude_code ?? 0} Claude Code · ${s.sessionsByTool.codex ?? 0} Codex`} />
      </div>
      {b && b.budgetCents > 0 && (
        <section className="card" data-tour="budget" aria-label="Monthly budget" style={pct >= 100 ? { borderColor: 'var(--no-line)' } : undefined}>
          <div className="between" style={{ alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><h2 style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{b.month} budget <InfoTip text="Set by your admin. Alerts at 80% and 100%. Your tools are never blocked." /></h2><span className="card-sub">Set by your admin · resets {date(b.resetsOn)} · alerts at 80% and 100%</span></div>
            <span className="mono" style={{ fontSize: 26 }}>{usd(b.spentCents / 100)} <span className="muted" style={{ fontSize: 16 }}>of {usd(b.budgetCents / 100, 0)}</span></span>
          </div>
          <Meter pct={pct} color={budgetColor(pct)} />
          <span style={{ fontSize: 14, fontWeight: 600, color: pct >= 100 ? 'var(--red)' : 'var(--text2)' }}>{pct >= 100 ? 'Budget reached. Your admin has been emailed.' : `${pct}% used. Projected ${usd(b.projectedCents / 100, 0)} by month end.`}</span>
        </section>
      )}
      {!empty && (
        <>
          <div className="row">
            <Card title="Daily spend" sub="API-equivalent, USD · hover a bar for details" style={{ flex: '2 1 480px' }}>
              <StackedBars data={s.daily.map((d: any) => ({ label: days === '30' ? d.day.slice(8) : d.label, claude: d.claude, codex: d.codex }))} />
              <div className="legend"><span><i style={{ background: 'var(--s1)' }} />Claude Code {usd(s.costByTool.claude_code ?? 0)}</span><span><i style={{ background: 'var(--s2)' }} />Codex {usd(s.costByTool.codex ?? 0)}</span></div>
            </Card>
            <Card title="Tool and model mix" sub={`Share of ${usd(s.cost)}`} style={{ flex: '1 1 340px' }}>
              <div className="donut-row">
                <Donut value={claudeShare} label={claudeShare + '%'} sub="Claude Code" />
                <div className="col" style={{ flex: '1 1 160px', gap: 12 }}><ShareRows rows={(s.models ?? []).slice(0, 4).map((m: any) => ({ name: m.name, share: m.share, right: m.share + '%', color: m.tool === 'codex' ? 'var(--s2)' : 'var(--s1)' }))} /></div>
              </div>
            </Card>
          </div>
          <div className="row">
            <Card title="When you code with AI" sub="Active time by weekday and 2-hour block" style={{ flex: '1 1 420px' }}>
              <Heatmap rows={s.heat} />
              {s.peak && <span className="text2" style={{ fontSize: 14 }}>Your peak is {s.peak}.</span>}
            </Card>
            <Card title="Top projects" sub="Time and spend · names stay on this device" style={{ flex: '1 1 420px' }}>
              <ShareRows rows={(s.projects ?? []).map((p: any) => ({ name: p.name, share: p.pct, right: `${p.hours} h · ${usd(p.cost)}` }))} />
            </Card>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            <div className="card gold-card"><span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', color: 'var(--gold)' }}>SAVED BY CACHING</span><b style={{ fontSize: 18 }}>About {usd(s.saved, 0)}</b><span className="text2" style={{ fontSize: 14 }}>{s.cacheShare}% of your input came from cache, billed at a fraction of the normal rate.</span></div>
            {s.priciest && <div className="card"><span className="muted" style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em' }}>PRICIEST SESSION</span><b style={{ fontSize: 18, overflowWrap: 'anywhere' }}>{usd(s.priciest.cost)} on {s.priciest.project}</b><span className="text2" style={{ fontSize: 14 }}>{s.priciest.insight}</span></div>}
            {s.busiestDay && <div className="card"><span className="muted" style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em' }}>BUSIEST DAY</span><b style={{ fontSize: 18 }}>{s.busiestDay.day}</b><span className="text2" style={{ fontSize: 14 }}>{s.busiestDay.hours} hours of active time.</span></div>}
          </div>
          <Card title="Recent sessions" right={<button className="btn btn-ghost" onClick={() => ctx.go('/sessions')}>View all sessions</button>}>
            <TableScroll label="Recent sessions" sticky><table className="t" style={{ '--min': '640px' } as React.CSSProperties}>
              <thead><tr><th>Started</th><th>Project</th><th>Tool</th><th className="r">Active</th><th className="r">Tokens</th><th className="r">Cost</th></tr></thead>
              <tbody>{s.recent.map((r: any) => (
                <tr key={r.tool + r.id}><td className="text2">{when(r.start)}</td><td><b style={{ overflowWrap: 'anywhere' }}>{r.project}</b></td>
                  <td><span className="text2" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: r.tool === 'codex' ? 'var(--s2)' : 'var(--s1)' }} />{r.tool === 'codex' ? 'Codex' : 'Claude Code'}</span></td>
                  <td className="r mono">{mins(r.activeMinutes)}</td><td className="r mono">{num(r.tokens)}</td><td className="r mono">{usd(r.cost)}</td></tr>
              ))}</tbody>
            </table></TableScroll>
          </Card>
        </>
      )}
    </>
  );
}
