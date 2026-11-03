import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';
import { passwordRules } from './format';
import { useFocusTrap, useMedia, type Theme } from './hooks';
import { mq } from './breakpoints';

export function Logo({ size = 38 }: { size?: number }) {
  return <span className="logo" style={{ width: size, height: size, fontSize: Math.round(size * 0.52), borderRadius: Math.round(size * 0.29) }}>a</span>;
}

export function Card({ title, sub, right, children, className = '', style }: { title?: ReactNode; sub?: ReactNode; right?: ReactNode; children?: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={'card ' + className} style={style}>
      {(title || right) && (
        <div className="between" style={{ alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {title && <h2>{title}</h2>}
            {sub && <span className="card-sub">{sub}</span>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function InfoTip({ text }: { text: string }) {
  return <span title={text} aria-label={text} role="img" style={{ display: 'inline-flex', color: 'var(--muted)', cursor: 'help' }}><Icon name="info" size={15} /></span>;
}

export function Kpi({ label, value, sub, tip, variant }: { label: string; value: ReactNode; sub?: ReactNode; tip?: string; variant?: 'hero' | 'gold' }) {
  return (
    <div className={'card kpi ' + (variant === 'hero' ? 'hero' : variant === 'gold' ? 'gold-card' : '')} style={{ gap: 10 }}>
      <span className="label">{label}{tip && <InfoTip text={tip} />}</span>
      <span className="value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

export function Pill({ kind = 'neutral', children }: { kind?: 'ok' | 'warn' | 'no' | 'gold' | 'accent' | 'neutral'; children: ReactNode }) {
  return <span className={'pill pill-' + kind}>{children}</span>;
}

export function Field({ label, id, hint, error, ...rest }: { label: string; id: string; hint?: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" aria-invalid={error ? 'true' : undefined} aria-describedby={error || hint ? id + '-msg' : undefined} {...rest} />
      {error ? <span id={id + '-msg'} className="error-text">{error}</span> : hint ? <span id={id + '-msg'} className="hint">{hint}</span> : null}
    </div>
  );
}

export function PasswordField({ label, id, value, onChange, autoComplete = 'current-password' }: { label: string; id: string; value: string; onChange: (v: string) => void; autoComplete?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input id={id} className="input" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} style={{ paddingRight: 52 }} />
        <button type="button" className="icon-btn" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)} style={{ position: 'absolute', right: 2, top: 2, border: 'none', background: 'transparent', color: 'var(--muted)' }}>
          <Icon name="eye" />
        </button>
      </div>
    </div>
  );
}

export function Checklist({ pw, email }: { pw: string; email?: string }) {
  return (
    <div className="checklist" aria-label="Password requirements">
      {passwordRules(pw, email).map((r) => (
        <span key={r.text} className="check-item" style={{ color: r.ok ? 'var(--text)' : 'var(--muted)' }}>
          <span className="dot-ok" style={{ background: r.ok ? 'var(--ok-bg)' : 'var(--raised)', color: r.ok ? 'var(--ok-text)' : 'var(--muted)' }}><Icon name="check" size={12} stroke={3} /></span>
          {r.text}
        </span>
      ))}
    </div>
  );
}

export const passwordOk = (pw: string, email = '') => passwordRules(pw, email).every((r) => r.ok);

export function OtpInput({ value, onChange, label = 'Verification code' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');
  const set = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d || ' ';
    onChange(next.join('').replace(/\s+$/, ''));
  };
  return (
    <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
      <legend className="lbl" style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, padding: 0 }}>{label}</legend>
      <div className="otp">
        {digits.map((d, i) => (
          <input key={i} ref={(el) => (refs.current[i] = el)} aria-label={`Digit ${i + 1}`} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'} maxLength={1} value={d.trim()}
            onPaste={(e) => {
              const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
              if (t) { e.preventDefault(); onChange(t); refs.current[Math.min(t.length, 5)]?.focus(); }
            }}
            onKeyDown={(e) => { if (e.key === 'Backspace' && !d.trim() && i > 0) refs.current[i - 1]?.focus(); }}
            onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(-1); set(i, v); if (v && i < 5) refs.current[i + 1]?.focus(); }} />
        ))}
      </div>
    </fieldset>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => <button type="button" key={o.value} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function SwitchRow({ id, label, desc, checked, onChange }: { id: string; label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="switch-row">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <label htmlFor={id} style={{ fontWeight: 700 }}>{label}</label>
        <span className="text2" style={{ fontSize: 14 }}>{desc}</span>
      </div>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

export function Modal({ title, kicker, onClose, children, labelledBy = 'modal-title', alert }: { title: string; kicker?: string; onClose: () => void; children: ReactNode; labelledBy?: string; alert?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role={alert ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={labelledBy}>
        <div className="between" style={{ alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {kicker && <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.08em', color: 'var(--gold)' }}>{kicker}</span>}
            <h2 id={labelledBy}>{title}</h2>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [text, onDone]);
  return <div className="toast" role="status">{text}</div>;
}

export function Meter({ pct, color, tick = true }: { pct: number; color?: string; tick?: boolean }) {
  const c = color ?? (pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--s1)');
  return <div className="meter"><div style={{ width: Math.min(100, pct) + '%', background: c }} />{tick && <span className="tick" title="80% alert" />}</div>;
}

export function budgetColor(p: number) { return p >= 100 ? 'var(--red)' : p >= 80 ? 'var(--amber)' : 'var(--s1)'; }

export function StackedBars({ data, labelFmt }: { data: { label: string; claude: number; codex: number }[]; labelFmt?: (v: number) => string }) {
  const max = Math.max(0.01, ...data.map((d) => d.claude + d.codex));
  const f = labelFmt ?? ((v: number) => '$' + (v >= 100 ? Math.round(v) : v.toFixed(1)));
  return (
    <>
      <div className="bars">
        {data.map((d, i) => (
          <div className="b" key={i} title={`${d.label}: Claude Code ${f(d.claude)}, Codex ${f(d.codex)}`}>
            <span className="v">{d.claude + d.codex > 0 ? f(d.claude + d.codex) : ''}</span>
            <div className="stack">
              <div style={{ height: (d.codex / max) * 150, background: 'var(--s2)', borderRadius: '6px 6px 0 0' }} />
              <div style={{ height: Math.max(d.claude > 0 ? 2 : 0, (d.claude / max) * 150), background: 'var(--s1)', borderRadius: d.codex > 0 ? '0 0 3px 3px' : '6px 6px 3px 3px' }} />
            </div>
          </div>
        ))}
      </div>
      <div className="bar-labels">{data.map((d, i) => <span key={i}>{d.label}</span>)}</div>
    </>
  );
}

export function Donut({ value, label, sub }: { value: number; label: string; sub: string }) {
  const c = 2 * Math.PI * 54;
  return (
    <svg viewBox="0 0 140 140" style={{ width: 140, height: 140, flex: 'none' }} role="img" aria-label={`${label} ${value}%`}>
      <circle cx="70" cy="70" r="54" fill="none" stroke="var(--s2)" strokeWidth="18" />
      <circle cx="70" cy="70" r="54" fill="none" stroke="var(--s1)" strokeWidth="18" strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 70 70)" />
      <text x="70" y="68" textAnchor="middle" fontSize="22" fontFamily="IBM Plex Mono, monospace" fill="var(--text)">{label}</text>
      <text x="70" y="88" textAnchor="middle" fontSize="11" fill="var(--muted)">{sub}</text>
    </svg>
  );
}

export function Heatmap({ rows }: { rows: number[][] }) {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <div className="heat" role="img" aria-label="Active time by weekday and two-hour block">
      {rows.map((r, i) => (
        <div className="hr" key={i}><span>{days[i]}</span>{r.map((lv, j) => <div key={j} className="c" title={`${days[i]} ${j * 2}:00–${j * 2 + 2}:00`} style={{ background: `var(--heat${lv})` }} />)}</div>
      ))}
      <div style={{ display: 'flex', paddingLeft: 42, fontSize: 11, color: 'var(--muted)' }}><span style={{ flex: 3 }}>12a</span><span style={{ flex: 3 }}>6a</span><span style={{ flex: 3 }}>12p</span><span style={{ flex: 3 }}>6p</span></div>
    </div>
  );
}

export function ShareRows({ rows }: { rows: { name: string; share: number; right: string; color?: string }[] }) {
  return (
    <>
      {rows.map((m) => (
        <div key={m.name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="between" style={{ fontSize: 14 }}><span style={{ fontWeight: 700 }}>{m.name}</span><span className="mono text2" style={{ fontSize: 13 }}>{m.right}</span></div>
          <div className="meter"><div style={{ width: Math.min(100, m.share) + '%', background: m.color ?? 'var(--s1)' }} /></div>
        </div>
      ))}
    </>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div style={{ padding: '28px 8px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 16, fontWeight: 700 }}>{title}</span><span className="text2" style={{ maxWidth: 420 }}>{body}</span>{action}
    </div>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <span>© {new Date().getFullYear()} Aknologia. All rights reserved.</span>
      <span style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}><a href="https://aknologia.com/#privacy" target="_blank" rel="noreferrer">Privacy</a><a href="https://aknologia.com/#terms" target="_blank" rel="noreferrer">Terms</a><a href="https://aknologia.com/#status" target="_blank" rel="noreferrer">System status</a><span>Version 1.0.0</span></span>
    </footer>
  );
}

export function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  // keyed by theme: the new icon is inserted on a switch and rotates in (CSS, only while html.theme-anim is set)
  return <button className="icon-btn" aria-label={label} title={label} onClick={onToggle}><span key={theme} className="theme-ico"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></span></button>;
}

// ---------- tour ----------
export type TourStep = { target: string; title: string; body: string };

export function Tour({ steps, onDone }: { steps: TourStep[]; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const step = steps[i];
  useEffect(() => {
    const el = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null;
    document.querySelectorAll('.tour-target').forEach((e) => e.classList.remove('tour-target'));
    if (!el) { setPos({ top: 120, left: window.innerWidth / 2 - 170 }); return; }
    el.classList.add('tour-target');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const place = () => {
      const r = el.getBoundingClientRect();
      const left = Math.min(Math.max(16, r.left), window.innerWidth - 356);
      const below = r.bottom + 12 + 220 < window.innerHeight;
      setPos({ top: below ? r.bottom + 12 : Math.max(16, r.top - 232), left });
    };
    const t = setTimeout(place, 300);
    window.addEventListener('resize', place);
    return () => { clearTimeout(t); window.removeEventListener('resize', place); el.classList.remove('tour-target'); };
  }, [step]);
  const finish = () => { document.querySelectorAll('.tour-target').forEach((e) => e.classList.remove('tour-target')); onDone(); };
  return (
    <>
      <div className="tour-dim" onClick={finish} />
      {pos && (
        <div className="tour-card" role="dialog" aria-label="Product tour" style={{ top: pos.top, left: pos.left }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '.06em', color: 'var(--gold)' }}>STEP {i + 1} OF {steps.length}</span>
          <span style={{ fontSize: 17, fontWeight: 800 }}>{step.title}</span>
          <span className="text2" style={{ fontSize: 14 }}>{step.body}</span>
          <div className="between">
            <span style={{ display: 'flex', gap: 6 }}>{steps.map((_, k) => <span key={k} style={{ width: 8, height: 8, borderRadius: '50%', background: k === i ? 'var(--accent)' : 'var(--border-strong)' }} />)}</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={finish}>Skip</button>
              <button className="btn btn-primary btn-sm" onClick={() => (i + 1 >= steps.length ? finish() : setI(i + 1))}>{i + 1 >= steps.length ? 'Done' : 'Next'}</button>
            </span>
          </div>
        </div>
      )}
    </>
  );
}

// ---------- app shell ----------
export type NavItem = { key: string; label: string; icon: string; group: 'WORKSPACE' | 'ACCOUNT' };

export function AppShell(props: {
  nav: NavItem[]; active: string; onNav: (k: string) => void; brandSub: string; crumb: string; title: string; sub: ReactNode;
  user: { initials: string; name: string; role: string }; theme: Theme; onTheme: () => void; onTour: () => void; onSignOut: () => void;
  actions?: ReactNode; syncLabel: string; syncNote: ReactNode; onSync: () => void; syncing: boolean; sideCard: ReactNode; notifications?: number; searchPlaceholder: string; children: ReactNode;
}) {
  const groups: NavItem['group'][] = ['WORKSPACE', 'ACCOUNT'];
  // Below lg the sidebar is a drawer; the desktop window (html[data-app=desktop]) keeps a compact sidebar down to md.
  const isDrawer = useMedia(mq.below(typeof document !== 'undefined' && document.documentElement.dataset.app === 'desktop' ? 'md' : 'lg'));
  const [open, setOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const sideRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const h1Ref = useRef<HTMLHeadingElement>(null);
  const navigated = useRef(false);
  const drawerOpen = open && isDrawer;
  useEffect(() => { if (!isDrawer) setOpen(false); }, [isDrawer]);
  useEffect(() => {
    const main = mainRef.current, html = document.documentElement;
    if (!drawerOpen) return;
    if (main) main.inert = true;
    html.classList.add('scroll-lock');
    return () => { if (main) main.inert = false; html.classList.remove('scroll-lock'); };
  }, [drawerOpen]);
  useFocusTrap(sideRef, drawerOpen, {
    onEscape: () => setOpen(false),
    initial: () => sideRef.current?.querySelector<HTMLElement>('[aria-current="page"]'),
    restoreTo: () => { const h = navigated.current ? h1Ref.current : menuBtn.current; navigated.current = false; return h; },
  });
  const nav = (k: string) => {
    if (drawerOpen) { navigated.current = true; setOpen(false); }
    props.onNav(k);
  };
  // B4: decorative indicator that slides to the active nav item (transform only; no transition on first placement)
  const [ind, setInd] = useState<{ y: number; h: number; ready: boolean } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const el = sideRef.current?.querySelector<HTMLElement>('.nav-item[aria-current="page"]');
      setInd((p) => (el ? { y: el.offsetTop, h: el.offsetHeight, ready: !!p } : null));
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [props.active]);
  const route = typeof window !== 'undefined' ? window.location.hash.split('?')[0] || '#/' : '';
  return (
    <div className={'shell' + (isDrawer ? ' drawer-mode' : '') + (drawerOpen ? ' nav-open' : '')}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <nav className="side" id="side-nav" aria-label="Main" ref={sideRef}>
        <a className="brand" href="#/"><Logo /><span style={{ display: 'flex', flexDirection: 'column' }}><span className="display" style={{ fontSize: 19, fontWeight: 700 }}>aknologia</span><span className="muted" style={{ fontSize: 12 }}>{props.brandSub}</span></span></a>
        {ind && <span className={'nav-indicator' + (ind.ready ? ' ready' : '')} aria-hidden="true" style={{ height: ind.h, transform: `translateY(${ind.y}px)` }} />}
        {groups.map((g) => (
          <div key={g} style={{ display: 'flex', flexDirection: 'column', gap: 2 }} data-tour={g === 'ACCOUNT' ? 'nav-account' : undefined}>
            <span className="nav-group">{g}</span>
            {props.nav.filter((n) => n.group === g).map((n) => (
              <button key={n.key} className="nav-item" aria-current={props.active === n.key ? 'page' : undefined} onClick={() => nav(n.key)}><Icon name={n.icon} />{n.label}</button>
            ))}
          </div>
        ))}
        <div className="side-foot">{props.sideCard}</div>
      </nav>
      <div className="nav-backdrop" aria-hidden="true" onClick={() => setOpen(false)} />
      <div className="main-col" ref={mainRef}>
        <div className="topbar">
          <button ref={menuBtn} className="icon-btn menu-btn" aria-label={drawerOpen ? 'Close menu' : 'Open menu'} aria-controls="side-nav" aria-expanded={drawerOpen} onClick={() => setOpen((o) => !o)}><Icon name="menu" /></button>
          <nav aria-label="Breadcrumb" className="topbar-crumb"><span className="crumb-org">{props.crumb}</span><span className="crumb-sep"><Icon name="chev" size={14} /></span><span aria-current="page" className="crumb-title">{props.title}</span></nav>
          <span className="topbar-spacer" />
          <div className="search topbar-search"><span className="ico"><Icon name="search" /></span><input className="input" type="search" aria-label="Search" placeholder={props.searchPlaceholder} /><kbd>⌘K</kbd></div>
          <button className="icon-btn" aria-label={props.notifications ? `Notifications, ${props.notifications} new` : 'Notifications'}><Icon name="bell" />{!!props.notifications && <span className="badge-dot" />}</button>
          <span data-tour="help-theme" className="topbar-icons">
            <button className="icon-btn" aria-label="Start the tour" title="Start the tour" onClick={props.onTour}><Icon name="help" /></button>
            <ThemeToggle theme={props.theme} onToggle={props.onTheme} />
          </span>
          <UserMenu user={props.user} open={userMenu} setOpen={setUserMenu} onSignOut={props.onSignOut} />
        </div>
        <main className="content" id="main" tabIndex={-1}>
          <header className="page-head">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}><h1 ref={h1Ref} tabIndex={-1}>{props.title}</h1><span className="sub">{props.sub}</span></div>
            <div className="page-actions">
              <span className="muted sync-note"><Icon name="clock" size={14} />{props.syncNote}</span>
              {props.actions}
              <button className="btn btn-primary" data-tour="sync" onClick={props.onSync} disabled={props.syncing}><Icon name="sync" size={16} />{props.syncing ? 'Syncing…' : props.syncLabel}</button>
            </div>
          </header>
          {/* keyed by route only (never by data/poll ticks), so the enter transition plays once per navigation */}
          <div className="page" key={route}>{props.children}</div>
        </main>
        <Footer />
      </div>
    </div>
  );
}

/** D13: the avatar opens a small menu with "Sign out" (one accidental tap no longer signs out). */
function UserMenu({ user, open, setOpen, onSignOut }: { user: { initials: string; name: string; role: string }; open: boolean; setOpen: (o: boolean) => void; onSignOut: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => item.current?.focus());
    const down = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
      else if (e.key === 'Tab') setOpen(false);
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, setOpen]);
  return (
    <div className="user-wrap" ref={wrap}>
      <button ref={btn} className="btn btn-ghost user-btn" aria-haspopup="menu" aria-expanded={open} aria-controls="user-menu" onClick={() => setOpen(!open)}>
        <span className="avatar avatar-gold" style={{ width: 38, height: 38 }}>{user.initials}</span>
        <span className="user-meta"><span className="user-name">{user.name}</span><span className="muted user-role">{user.role} · Sign out</span></span>
      </button>
      {open && (
        <div className="user-menu" id="user-menu" role="menu" aria-label={user.name}>
          <button ref={item} role="menuitem" className="user-menu-item" onClick={() => { setOpen(false); onSignOut(); }}><Icon name="logout" size={16} />Sign out</button>
        </div>
      )}
    </div>
  );
}

// ---------- auth layout ----------
export function AuthLayout({ sub, landing, theme, onTheme, children }: { sub: string; landing: string; theme: Theme; onTheme: () => void; children: ReactNode }) {
  return (
    <div className="auth">
      <svg className="auth-rings" viewBox="0 0 1200 1200" aria-hidden="true">
        {[[260, 0.9], [360, 0.6], [470, 0.4], [590, 0.25]].map(([r, o]) => <circle key={r} cx="600" cy="600" r={r} fill="none" stroke="var(--accent-line)" strokeOpacity={o} />)}
        <circle cx="860" cy="340" r="5" fill="var(--gold)" /><circle cx="290" cy="760" r="4" fill="var(--s1)" /><circle cx="1010" cy="820" r="3" fill="var(--s2)" />
      </svg>
      <div className="chip" aria-hidden="true" style={{ right: 'calc(50% + 268px)', top: 230, transform: 'rotate(-3deg)' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em' }} className="muted">ACTIVE TIME</span><span className="mono" style={{ fontSize: 22 }}>Hours, not guesses</span>
      </div>
      <div className="chip" aria-hidden="true" style={{ left: 'calc(50% + 268px)', top: 420, transform: 'rotate(3deg)' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em' }} className="muted">SAVED BY CACHING</span><span className="mono" style={{ fontSize: 22, color: 'var(--gold)' }}>Tracked weekly</span>
      </div>
      <div className="chip" aria-hidden="true" style={{ right: 'calc(50% + 280px)', top: 640, transform: 'rotate(2deg)', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <span className="avatar" style={{ background: 'var(--accent-soft)', color: 'var(--accent-ink)', width: 30, height: 30 }}><Icon name="shield" size={15} /></span><span style={{ fontSize: 13, fontWeight: 600 }}>0 bytes of code collected</span>
      </div>
      <header className="auth-head">
        <a href={landing} className="brand" style={{ padding: 0 }}><Logo /><span style={{ display: 'flex', flexDirection: 'column' }}><span className="display" style={{ fontSize: 19, fontWeight: 700 }}>aknologia</span><span className="muted" style={{ fontSize: 12 }}>{sub}</span></span></a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <a href={landing + '#pricing'} target="_blank" rel="noreferrer" className="btn btn-ghost">Pricing</a>
          <a href={landing + '#demo'} target="_blank" rel="noreferrer" className="btn btn-ghost">Book a demo</a>
          <a href={landing} target="_blank" rel="noreferrer" className="btn btn-ghost">aknologia.com <Icon name="ext" size={14} /></a>
          <ThemeToggle theme={theme} onToggle={onTheme} />
        </div>
      </header>
      <main className="auth-main">
        <div className="auth-card">
          <div className="ribbon"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="lock" size={14} />SECURE SIGN-IN</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)' }} />INVITE-ONLY</span></div>
          {children}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px 26px', fontSize: 13 }} className="text2">
          {[['shield', 'Only token counts and timestamps are shared'], ['lock', 'Prompts and code stay on your device'], ['mail', 'Invite-only access']].map(([i, t]) => <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ color: 'var(--accent-ink)' }}><Icon name={i} size={16} /></span>{t}</span>)}
        </div>
        <span className="text2" style={{ fontSize: 14 }}>New to Aknologia? <a href={landing + '#pricing'} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>See pricing</a> or <a href={landing + '#demo'} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>book a demo</a></span>
      </main>
      <Footer />
    </div>
  );
}

export function Tabs({ a, b, value, onChange }: { a: string; b: string; value: 'a' | 'b'; onChange: (v: 'a' | 'b') => void }) {
  return (
    <div className="tabs" role="tablist" aria-label="Account">
      <button role="tab" aria-selected={value === 'a'} onClick={() => onChange('a')}>{a}</button>
      <button role="tab" aria-selected={value === 'b'} onClick={() => onChange('b')}>{b}</button>
    </div>
  );
}

export function Stepper({ step }: { step: 0 | 1 | 2 }) {
  return (
    <ol className="stepper" aria-label="Reset progress">
      {['Your email', 'Email code', 'New password'].map((l, i) => <li key={l} className={(i <= step ? 'done ' : '') + (i === step ? 'cur' : '')} aria-current={i === step ? 'step' : undefined}><span />{l}</li>)}
    </ol>
  );
}
