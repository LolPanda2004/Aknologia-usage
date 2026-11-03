import { useMemo, useState } from 'react';
import { agent } from '../api';
import { useAsync } from '../../shared/hooks';
import { Card, Empty, InfoTip } from '../../shared/ui';
import { mins, num, usd, when } from '../../shared/format';
import type { DCtx } from '../main';

const SPLIT = ['var(--s1)', 'var(--accent-ink)', 'var(--s2)', 'var(--border-strong)'];

export default function Sessions({ ctx }: { ctx: DCtx }) {
  const { data } = useAsync(() => agent('/sessions?days=30'), [ctx.tick]);
  const [q, setQ] = useState('');
  const [tool, setTool] = useState('all');
  const [sort, setSort] = useState('recent');
  const [pick, setPick] = useState(0);
  const rows = useMemo(() => {
    let r = (data ?? []).filter((s: any) => (tool === 'all' || s.tool === tool) && (!q || s.project.toLowerCase().includes(q.toLowerCase())));
    if (sort === 'cost') r = [...r].sort((a: any, b: any) => b.cost - a.cost);
    if (sort === 'long') r = [...r].sort((a: any, b: any) => b.activeMinutes - a.activeMinutes);
    return r;
  }, [data, q, tool, sort]);
  if (!data) return <Card><span className="muted">Reading sessions…</span></Card>;
  const s = rows[Math.min(pick, rows.length - 1)];
  const maxAct = s ? Math.max(1, ...s.activity) : 1;
  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
        <div className="field" style={{ flex: '1 1 260px' }}><label htmlFor="ss-q">Search sessions</label><input id="ss-q" className="input" type="search" placeholder="billing-service" value={q} onChange={(e) => { setQ(e.target.value); setPick(0); }} /></div>
        <div className="field"><label htmlFor="ss-tool">Tool</label><select id="ss-tool" className="input" value={tool} onChange={(e) => { setTool(e.target.value); setPick(0); }}><option value="all">All tools</option><option value="claude_code">Claude Code</option><option value="codex">Codex</option></select></div>
        <div className="field"><label htmlFor="ss-sort">Sort by</label><select id="ss-sort" className="input" value={sort} onChange={(e) => setSort(e.target.value)}><option value="recent">Most recent</option><option value="cost">Highest cost</option><option value="long">Longest</option></select></div>
      </div>
      {rows.length === 0 ? <Card><Empty title="No sessions in the last 30 days" body="Sessions appear here as soon as you use Claude Code or Codex." /></Card> : (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <section aria-label="Session list" className="card" style={{ flex: '3 1 480px', padding: 8, gap: 2 }}>
            {rows.map((r: any, i: number) => {
              const sel = r === s;
              return (
                <button key={r.tool + r.id} onClick={() => setPick(i)} aria-pressed={sel} style={{ textAlign: 'left', cursor: 'pointer', border: `1px solid ${sel ? 'var(--accent-line)' : 'transparent'}`, borderRadius: 14, padding: 14, background: sel ? 'var(--accent-soft)' : 'transparent', color: 'var(--text)', display: 'grid', gridTemplateColumns: 'minmax(0,2fr) repeat(3, minmax(0,1fr))', gap: 12, alignItems: 'center', minHeight: 60 }}>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.project}</b><span className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 2, background: r.tool === 'codex' ? 'var(--s2)' : 'var(--s1)' }} />{r.tool === 'codex' ? 'Codex' : 'Claude Code'} · {when(r.start)}</span></span>
                  <span className="mono text2" style={{ fontSize: 13 }}>{mins(r.activeMinutes)}</span><span className="mono text2" style={{ fontSize: 13 }}>{num(r.tokens)}</span><span className="mono" style={{ fontSize: 15, textAlign: 'right' }}>{usd(r.cost)}</span>
                </button>
              );
            })}
          </section>
          {s && (
            <aside aria-label="Session detail" className="card" style={{ flex: '2 1 360px', gap: 20 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span className="muted" style={{ fontSize: 12 }}>{s.tool === 'codex' ? 'Codex' : 'Claude Code'} · {s.model || 'unknown model'}</span><h2 style={{ fontSize: 22 }}>{s.project}</h2><span className="text2" style={{ fontSize: 13 }}>{when(s.start)} – {new Date(s.end).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span></div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10 }}>
                {[['Cost', usd(s.cost)], ['Active', mins(s.activeMinutes)], ['Turns', s.turns]].map(([l, v]) => <div key={l as string} style={{ background: 'var(--inset)', borderRadius: 12, padding: 12 }}><span className="muted" style={{ fontSize: 12 }}>{l}</span><div className="mono" style={{ fontSize: 22 }}>{v}</div></div>)}
              </div>
              <div className="col" style={{ gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>Where the tokens went <InfoTip text="Output tokens cost the most per token. Cache reads cost the least." /></h3>
                <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 }}>{s.split.map((p: any, i: number) => <div key={p.label} style={{ width: p.pct + '%', background: SPLIT[i] }} />)}</div>
                {s.split.map((p: any, i: number) => <div key={p.label} className="between" style={{ fontSize: 13 }}><span className="text2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: SPLIT[i] }} />{p.label}</span><span className="mono">{num(p.tokens)} · {usd(p.cost)}</span></div>)}
              </div>
              <div className="col" style={{ gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>Activity across the session</h3>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 64, borderBottom: '1px solid var(--border)' }}>{s.activity.map((v: number, i: number) => <div key={i} style={{ flex: 1, height: Math.max(2, (v / maxAct) * 60), background: 'var(--s1)', borderRadius: '3px 3px 0 0' }} />)}</div>
              </div>
              <div className="banner banner-gold" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}><b style={{ color: 'var(--gold-ink)', fontSize: 14 }}>What drove the cost</b><span style={{ fontSize: 14 }}>{s.insight}</span></div>
            </aside>
          )}
        </div>
      )}
    </>
  );
}
