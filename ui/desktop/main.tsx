import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/theme.css';
import { agent, pair, server } from './api';
import { useRoute, useTheme } from '../shared/hooks';
import { AppShell, Toast, Tour, type NavItem, type TourStep } from '../shared/ui';
import { ago, time } from '../shared/format';
import Auth from './pages/Auth';
import Overview from './pages/Overview';
import Sessions from './pages/Sessions';
import Settings from './pages/Settings';
import Support from '../shared/Support';
import { Icon } from '../shared/icons';

const NAV: NavItem[] = [
  { key: 'overview', label: 'Overview', icon: 'home', group: 'WORKSPACE' },
  { key: 'sessions', label: 'Sessions', icon: 'list', group: 'WORKSPACE' },
  { key: 'support', label: 'Support', icon: 'life', group: 'ACCOUNT' },
  { key: 'settings', label: 'Settings and security', icon: 'gear', group: 'ACCOUNT' },
];
const TOUR: TourStep[] = [
  { target: 'kpis', title: 'Your week at a glance', body: 'Active time, spend, tokens, and sessions. Hover any info icon for the exact definition.' },
  { target: 'budget', title: 'Your budget', body: 'Set by your admin. You get a desktop notification at 80% and 100%. Your tools are never blocked.' },
  { target: 'sync', title: 'Force sync', body: 'Rescans Claude Code and Codex on this device and sends new usage now, instead of waiting for the hourly sync.' },
  { target: 'help-theme', title: 'Help and theme', body: 'Replay this tour from the question mark any time. The sun and moon switch light and dark mode.' },
  { target: 'nav-account', title: 'Support and settings', body: 'Report a bug, request a feature, change your password, or add a backup email.' },
];

export type DCtx = { status: any; toast: (t: string) => void; reloadStatus: () => void; tick: number; go: (to: string) => void };

function App() {
  const [theme, setTheme] = useTheme();
  const [path, , go] = useRoute();
  const [paired, setPaired] = useState<boolean | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [agentErr, setAgentErr] = useState('');
  const [toast, setToast] = useState('');
  const [tour, setTour] = useState(false);
  const [tick, setTick] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await agent('/status')); setAgentErr(''); } catch (e: any) { setAgentErr(e.message); }
  }, []);
  useEffect(() => { pair().then((ok) => { setPaired(ok); if (ok) load(); }); }, [load]);
  useEffect(() => { const t = setInterval(() => { load(); setTick((x) => x + 1); }, 30000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    if (status?.signedIn && !localStorage.getItem('akn-desk-toured')) { setTimeout(() => setTour(true), 900); localStorage.setItem('akn-desk-toured', '1'); }
  }, [status?.signedIn]);
  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  if (paired === null) return null;
  if (!paired || (agentErr && !status)) {
    return (
      <div className="auth" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="auth-card" style={{ margin: 24 }}>
          <h2>Connecting to the agent</h2>
          <span className="text2">{agentErr || 'This window isn’t paired with the background agent yet.'}</span>
          <span className="muted" style={{ fontSize: 13 }}>The agent runs in the background and reads Claude Code and Codex usage. If you just installed the app, start “Aknologia Agent” once, then reopen this window.</span>
          <button className="btn btn-primary btn-wide" onClick={() => { pair().then((ok) => { setPaired(ok); load(); }); }}><Icon name="sync" size={16} />Try again</button>
        </div>
      </div>
    );
  }
  if (!status) return null;
  if (!status.signedIn) return <Auth theme={theme} onTheme={toggle} status={status} onSignedIn={(s) => { setStatus(s); go('/'); setTick((x) => x + 1); }} />;

  const active = path.split('/').filter(Boolean)[0] ?? 'overview';
  const sync = async () => {
    setSyncing(true);
    try { const s = await agent('/sync', { body: {} }); setStatus(s); setTick((x) => x + 1); setToast(s.lastError ? s.lastError : `Synced. ${s.queued} events waiting.`); }
    catch (e: any) { setToast(e.message); load(); } finally { setSyncing(false); }
  };
  const ctx: DCtx = { status, toast: setToast, reloadStatus: load, tick, go };
  const first = (status.name || status.email || '').split(/[\s@]/)[0];
  const hour = new Date().getHours();
  const titles: Record<string, [string, string]> = {
    overview: [`Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}${first ? ', ' + first[0].toUpperCase() + first.slice(1) : ''}`, 'Your AI coding this week'],
    sessions: ['Sessions', 'Select one to see where the tokens went'],
    support: ['Support', 'Report a bug, request a feature, or ask us anything'],
    settings: ['Settings and security', 'Your account, sync, privacy, and preferences'],
  };
  const [title, sub] = titles[active] ?? titles.overview;
  const initials = (status.name || status.email).split(/[\s@]+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  const page =
    active === 'sessions' ? <Sessions ctx={ctx} /> :
    active === 'settings' ? <Settings ctx={ctx} theme={theme} setTheme={setTheme} /> :
    active === 'support' ? <Support call={server} toast={setToast} diagnostics={async () => ({ appVersion: status.version, sources: status.sources, queued: status.queued, lastSync: status.lastSync, lastError: status.lastError })} /> :
    <Overview ctx={ctx} />;
  return (
    <>
      <AppShell nav={NAV} active={active} onNav={(k) => go('/' + (k === 'overview' ? '' : k))} brandSub="Usage · Desktop" crumb={status.org || 'Aknologia'} title={title} sub={sub}
        user={{ initials, name: status.name || status.email, role: status.role === 'admin' ? 'Admin' : 'Member' }} theme={theme} onTheme={toggle} onTour={() => { go('/'); setTour(true); }}
        onSignOut={async () => { await agent('/auth/logout', { body: {} }); load(); }}
        syncLabel="Force sync" syncNote={`Last synced ${ago(status.lastSync)} · next ${time(status.nextSync)}`} onSync={sync} syncing={syncing || status.syncing}
        searchPlaceholder="Search sessions, projects, settings"
        sideCard={<div className="card" style={{ padding: 16, gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: status.lastError ? 'var(--amber)' : status.prefs.paused ? 'var(--muted)' : 'var(--green)' }} />{status.prefs.paused ? 'Tracking paused' : status.lastError ? 'Waiting to sync' : 'All synced'}</span>
          <span className="muted" style={{ fontSize: 12 }}>{status.queued} events waiting · next sync {time(status.nextSync)}</span></div>}>
        {status.lastError && <div className="banner banner-warn"><Icon name="alert" />{status.lastError}</div>}
        {page}
      </AppShell>
      {tour && <Tour steps={TOUR} onDone={() => setTour(false)} />}
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </>
  );
}

document.documentElement.dataset.app = 'desktop'; // compact sidebar instead of the drawer at 768–1023 (window minimum is 960)
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
