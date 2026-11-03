import { agent, server } from '../api';
import { Card, Pill, Segmented, SwitchRow } from '../../shared/ui';
import Security from '../../shared/Security';
import { Icon } from '../../shared/icons';
import { ago, time } from '../../shared/format';
import { prefersReducedMotion, type Theme } from '../../shared/hooks';
import type { DCtx } from '../main';

export default function Settings({ ctx, theme, setTheme }: { ctx: DCtx; theme: Theme; setTheme: (t: Theme | 'system') => void }) {
  const st = ctx.status;
  const prefs = st.prefs;
  const setPref = async (k: string, v: boolean) => { try { await agent('/prefs', { method: 'PUT', body: { ...prefs, [k]: v } }); ctx.reloadStatus(); } catch (e: any) { ctx.toast(e.message); } };
  const pref = localStorage.getItem('akn-theme') ?? 'system';
  return (
    <>
      <nav aria-label="Settings sections" className="section-chips">
        {/* D10: every chip has the same style (none is falsely marked as the current section) */}
        {[['security', 'Account and security', 'lock'], ['sync', 'Sync and sources', 'sync'], ['privacy', 'Privacy', 'shield'], ['prefs', 'Preferences', 'gear']].map(([id, l, i]) => (
          <button key={id} onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' })} className="btn btn-secondary" style={{ borderRadius: 999 }}><Icon name={i} size={16} />{l}</button>
        ))}
      </nav>
      <div id="security"><Security call={server} toast={ctx.toast} /></div>
      <div id="sync"><Card title="Sync and sources" sub="Automatic sync runs every hour. Force sync any time.">
        <div className="banner" style={{ background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' }}>
          <span className="logo" style={{ width: 52, height: 52, borderRadius: 14, fontSize: 0 }}><Icon name="sync" size={24} color="#fff" /></span>
          <span style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 3 }}><b style={{ color: 'var(--text)' }}>Force sync</b><span className="text2" style={{ fontSize: 14 }}>Rescans Claude Code and Codex on this device and sends anything new right away. Use it before a review or after working offline.</span></span>
          <button className="btn btn-primary" onClick={async () => { try { await agent('/sync', { body: {} }); ctx.reloadStatus(); ctx.toast('Synced'); } catch (e: any) { ctx.toast(e.message); } }}><Icon name="sync" size={16} />Force sync</button>
        </div>
        <div className="grid g4">
          {[['Last sync', ago(st.lastSync)], ['Next automatic', time(st.nextSync)], ['Waiting to send', `${st.queued} events`], ['Server', st.server.replace(/^https?:\/\//, '')]].map(([l, v]) => <div key={l} style={{ background: 'var(--inset)', borderRadius: 14, padding: 14 }}><span className="muted" style={{ fontSize: 12 }}>{l}</span><div className="mono" style={{ fontSize: 16, overflowWrap: 'anywhere' }}>{v}</div></div>)}
        </div>
        {st.sources.map((s: any) => (
          <div key={s.tool} className="between" style={{ padding: 16, borderRadius: 14, border: '1px solid var(--border)' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}><b style={{ display: 'flex', alignItems: 'center', gap: 8 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: s.tool === 'codex' ? 'var(--s2)' : 'var(--s1)' }} />{s.tool === 'codex' ? 'Codex' : 'Claude Code'}</b>
              <span className="mono muted" style={{ fontSize: 12, overflowWrap: 'anywhere' }}>{s.found ? `${s.path} · ${s.files} files · ${s.eventsToday} events today · ${s.unread} unread lines` : `Not found in ${s.roots.join(' or ')}`}</span></span>
            {!s.found ? <Pill kind="neutral">Not installed</Pill> : s.unread > 0 ? <Pill kind="warn">{s.unread} lines unread</Pill> : <Pill kind="ok">Reading normally</Pill>}
          </div>
        ))}
      </Card></div>
      <div id="privacy"><Card title="Privacy" sub="Exactly what leaves this device">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          {[['Shared with your admin', 'check', 'var(--green)', ['Token counts per turn', 'Model names', 'Session and message IDs', 'Timestamps', 'Projects as hashed IDs']], ['Never leaves this device', 'x', 'var(--red)', ['Prompts and replies', 'Code, diffs, and file contents', 'Tool and terminal output', 'Project names and paths']]].map(([h, i, c, xs]) => (
            <div key={h as string} style={{ padding: 18, borderRadius: 14, background: 'var(--inset)', display: 'flex', flexDirection: 'column', gap: 10 }}><b style={{ color: c as string, fontSize: 14 }}>{h as string}</b>
              {(xs as string[]).map((x) => <span key={x} className="text2" style={{ display: 'flex', gap: 10, fontSize: 14 }}><Icon name={i as string} size={16} stroke={3} color={c as string} />{x}</span>)}</div>
          ))}
        </div>
      </Card></div>
      <div id="prefs"><Card title="Preferences">
        <div>
          <SwitchRow id="pf-bud" label="Budget notifications" desc="Desktop notification when you reach 80% and 100% of your budget." checked={prefs.budgetNotifications} onChange={(v) => setPref('budgetNotifications', v)} />
          <SwitchRow id="pf-login" label="Start at login" desc="Keeps history complete. Claude Code deletes old session files after about 30 days." checked={prefs.startAtLogin} onChange={(v) => setPref('startAtLogin', v)} />
          <SwitchRow id="pf-pause" label="Pause tracking" desc="Stops reading new activity until you turn it back on. Your admin sees a gap, not a reason." checked={prefs.paused} onChange={(v) => setPref('paused', v)} />
          <div className="between" style={{ padding: '16px 0' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><b>Appearance</b><span className="text2" style={{ fontSize: 14 }}>Also available from the sun and moon button at the top of every screen.</span></span>
            <Segmented label="Appearance" value={pref as any} onChange={(v: any) => setTheme(v)} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          </div>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>Current theme: {theme}. Agent version {st.version}.</span>
        <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-danger-outline" onClick={async () => { await agent('/auth/logout', { body: {} }); ctx.reloadStatus(); }}><Icon name="logout" size={16} />Sign out</button></div>
      </Card></div>
    </>
  );
}
