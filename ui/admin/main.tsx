import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/theme.css';
import { api, auth } from './api';
import { useRoute, useTheme } from '../shared/hooks';
import { AppShell, Toast, Tour, type NavItem, type TourStep } from '../shared/ui';
import { ago } from '../shared/format';
import Auth, { type AuthStep } from './pages/Auth';
import Overview from './pages/Overview';
import Members from './pages/Members';
import Member from './pages/Member';
import Budgets from './pages/Budgets';
import Settings from './pages/Settings';
import Support from '../shared/Support';

const NAV: NavItem[] = [
  { key: 'overview', label: 'Team overview', icon: 'chart', group: 'WORKSPACE' },
  { key: 'members', label: 'Members', icon: 'users', group: 'WORKSPACE' },
  { key: 'budgets', label: 'Budgets and alerts', icon: 'wallet', group: 'WORKSPACE' },
  { key: 'support', label: 'Support', icon: 'life', group: 'ACCOUNT' },
  { key: 'settings', label: 'Settings and billing', icon: 'gear', group: 'ACCOUNT' },
];

const TOUR: TourStep[] = [
  { target: 'sync', title: 'Refresh data', body: 'Reloads the latest synced usage from the database and recomputes every chart. Members also sync hourly on their own.' },
  { target: 'alerts', title: 'Budget alerts', body: 'Who is over or close to their budget right now. You also get these by email.' },
  { target: 'kpis', title: 'Your team at a glance', body: 'Spend, active time, cost per hour, and caching savings. Hover any info icon for the exact definition.' },
  { target: 'help-theme', title: 'Help and theme', body: 'Replay this tour from the question mark. The sun and moon switch light and dark mode.' },
  { target: 'nav-account', title: 'Billing and support', body: 'Invoices, seats, backup email, and password live in Settings and billing. Reach us from Support.' },
];

export type Ctx = { me: any; toast: (t: string) => void; refreshKey: number; go: (to: string) => void; reloadMe: () => Promise<void> }; // reloadMe: after org or plan changes, so the header and sidebar update

function App() {
  const [theme, setTheme] = useTheme();
  const [path, query, go] = useRoute();
  const [me, setMe] = useState<any>(null);
  const [checked, setChecked] = useState(false);
  const [toast, setToast] = useState('');
  const [tour, setTour] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    if (!auth.token) { setChecked(true); return; }
    try { setMe(await api('/me')); } catch { auth.set(null); } finally { setChecked(true); }
  }, []);
  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => {
    if (me && !localStorage.getItem('akn-admin-toured')) { setTimeout(() => setTour(true), 800); localStorage.setItem('akn-admin-toured', '1'); }
  }, [me]);

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark');
  if (!checked) return null;
  if (!me) {
    const step = (['signup', 'accept'].includes(path.slice(1)) ? path.slice(1) : 'signin') as AuthStep;
    return <Auth theme={theme} onTheme={toggle} initial={step} initialEmail={query.get('email') ?? ''} onSignedIn={() => { go('/'); loadMe(); }} />;
  }
  if (me.user.role !== 'admin') {
    auth.set(null);
    return <Auth theme={theme} onTheme={toggle} onSignedIn={loadMe} />;
  }

  const seg = path.split('/').filter(Boolean);
  const active = seg[0] === 'members' && seg[1] ? 'members' : seg[0] ?? 'overview';
  const refresh = async () => {
    setSyncing(true);
    try { const r = await api('/admin/refresh', { body: {} }); setRefreshedAt(r.refreshedAt); setRefreshKey((k) => k + 1); setToast(`Refreshed ${r.events.toLocaleString()} events from the database`); }
    catch (e: any) { setToast(e.message); } finally { setSyncing(false); }
  };
  const ctx: Ctx = { me, toast: setToast, refreshKey, go, reloadMe: loadMe };
  const titles: Record<string, [string, string]> = {
    overview: ['Team overview', `${me.org.name} · this month`],
    members: ['Members', 'Only people you invite can sign in'],
    budgets: ['Budgets and alerts', 'Monthly spend limits per member · reset on the 1st'],
    support: ['Support', 'Report a bug, request a feature, or ask us anything'],
    settings: ['Settings and billing', 'Account security, organization, plan, and data'],
  };
  const [title, sub] = seg[0] === 'members' && seg[1] ? ['Member detail', 'Usage for one member this month'] : titles[active] ?? titles.overview;
  const initials = (me.user.name || me.user.email).split(/\s+/).map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();

  let page;
  if (seg[0] === 'members' && seg[1]) page = <Member id={seg[1]} ctx={ctx} />;
  else if (active === 'members') page = <Members ctx={ctx} />;
  else if (active === 'budgets') page = <Budgets ctx={ctx} />;
  else if (active === 'settings') page = <Settings ctx={ctx} onSignedOut={() => { setMe(null); }} />;
  else if (active === 'support') page = <Support call={(p, o) => api(p, o)} admin toast={setToast} />;
  else page = <Overview ctx={ctx} onRefreshedAt={setRefreshedAt} />;

  return (
    <>
      <AppShell nav={NAV} active={active} onNav={(k) => go('/' + (k === 'overview' ? '' : k))} brandSub="Usage · Admin console" crumb={me.org.name} title={title} sub={sub}
        user={{ initials, name: me.user.name || me.user.email, role: 'Admin' }} theme={theme} onTheme={toggle} onTour={() => { go('/'); setTour(true); }}
        onSignOut={async () => { try { await api('/auth/logout', { body: {} }); } catch { /* already signed out */ } auth.set(null); setMe(null); }}
        syncLabel="Refresh data" syncNote={refreshedAt ? `Refreshed from database ${ago(refreshedAt)}` : 'Members sync hourly'} onSync={refresh} syncing={syncing}
        searchPlaceholder="Search members, sessions, settings"
        sideCard={<div className="card gold-card" style={{ padding: 16, gap: 10 }}><span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.12em', color: 'var(--gold)' }}>{me.org.plan.toUpperCase()} PLAN</span><span className="text2" style={{ fontSize: 12 }}>{me.org.seats} seats · manage in Settings</span></div>}>
        {page}
      </AppShell>
      {tour && <Tour steps={TOUR} onDone={() => setTour(false)} />}
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
