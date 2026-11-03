import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';
import { passwordRules } from './format';
import { prefersReducedMotion, useElementWidth, useFirstRender, useFocusTrap, useMedia, type Theme } from './hooks';
import { MOTION, mq } from './breakpoints';

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

/** Parses "$1,234.56", "1.5 h", "2 of 4", "37%" into prefix / first number / suffix (null if no number). */
function splitNumber(t: string) {
  const m = /-?\d[\d,]*(\.\d+)?/.exec(t);
  if (!m) return null;
  const raw = m[0];
  const n = parseFloat(raw.replace(/,/g, ''));
  if (!isFinite(n)) return null;
  return { pre: t.slice(0, m.index), post: t.slice(m.index + raw.length), n, dec: m[1] ? m[1].length - 1 : 0, sep: raw.includes(',') };
}

/** KPI value that counts up once, on the first render of this page load only (digits aria-hidden; final value as sr-only text). */
function CountUp({ value, id }: { value: ReactNode; id: string }) {
  const first = useFirstRender(id);
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null;
  const parts = text != null ? splitNumber(text) : null;
  const [running, setRunning] = useState(() => first && !!parts && parts.n !== 0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!running || !parts) return;
    const p = parts;
    const start = performance.now();
    let raf = 0;
    const fmt = (v: number) => p.pre + (p.sep ? v.toLocaleString('en-US', { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec }) : v.toFixed(p.dec)) + p.post;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / MOTION.countUp);
      const e = 1 - Math.pow(1 - t, 3);
      if (ref.current) ref.current.textContent = fmt(p.n * e);
      if (t < 1) raf = requestAnimationFrame(tick); else setRunning(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // runs once per mount; later value changes render directly
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  if (!running || !parts) return <>{value}</>;
  return <><span aria-hidden="true" ref={ref}>{parts.pre + (0).toFixed(parts.dec) + parts.post}</span><span className="sr-only">{value}</span></>;
}

export function Kpi({ label, value, sub, tip, variant }: { label: string; value: ReactNode; sub?: ReactNode; tip?: string; variant?: 'hero' | 'gold' }) {
  const id = 'kpi:' + (typeof window !== 'undefined' ? window.location.hash.split('?')[0] : '') + ':' + label;
  return (
    <div className={'card kpi ' + (variant === 'hero' ? 'hero' : variant === 'gold' ? 'gold-card' : '')} style={{ gap: 10 }}>
      <span className="label">{label}{tip && <InfoTip text={tip} />}</span>
      <span className="value"><CountUp value={value} id={id} /></span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

/** C6: loading placeholder with shimmer; the loading text stays for screen readers in a status element. */
export function Skeleton({ label, kpis = 4, chart = true, table = true }: { label: string; kpis?: number; chart?: boolean; table?: boolean }) {
  return (
    <div className="skeleton-page" aria-busy="true">
      <span className="sr-only" role="status">{label}</span>
      {kpis > 0 && <div className="row" aria-hidden="true">{Array.from({ length: kpis }, (_, i) => <div key={i} className="card kpi skel-card"><span className="skel" style={{ width: '45%', height: 12 }} /><span className="skel" style={{ width: '70%', height: 30 }} /><span className="skel" style={{ width: '60%', height: 12 }} /></div>)}</div>}
      {chart && <div className="card skel-card" aria-hidden="true"><span className="skel" style={{ width: '30%', height: 16 }} /><span className="skel" style={{ width: '100%', height: 180 }} /></div>}
      {table && <div className="card skel-card" aria-hidden="true">{Array.from({ length: 4 }, (_, i) => <span key={i} className="skel" style={{ width: '100%', height: 36 }} />)}</div>}
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

/**
 * B5: exit animation without delaying unmount or changing any onClose flow — when the element unmounts, a
 * non-interactive snapshot (aria-hidden, inert, roles/ids stripped) animates out and is removed.
 */
function useExitGhost(ref: React.RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    const el = ref.current;
    return () => {
      if (!el || prefersReducedMotion()) return;
      const clone = el.cloneNode(true) as HTMLElement;
      queueMicrotask(() => {
        if (el.isConnected) return; // React StrictMode's simulated unmount keeps the node
        clone.setAttribute('aria-hidden', 'true');
        clone.inert = true;
        clone.removeAttribute('role'); clone.removeAttribute('id');
        clone.querySelectorAll('[role], [id]').forEach((n) => { n.removeAttribute('role'); n.removeAttribute('id'); });
        clone.classList.add('ghost');
        document.body.appendChild(clone);
        const done = () => clone.remove();
        clone.addEventListener('animationend', (e) => { if (e.target === clone) done(); });
        setTimeout(done, MOTION.page + 120);
      });
    };
  }, [ref]);
}

export function Modal({ title, kicker, onClose, children, labelledBy = 'modal-title', alert }: { title: string; kicker?: string; onClose: () => void; children: ReactNode; labelledBy?: string; alert?: boolean }) {
  const ov = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // D5: focus the first field, trap Tab inside, Escape closes, focus returns to the trigger
  useFocusTrap(box, true, { onEscape: onClose, initial: () => box.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])') });
  useExitGhost(ov);
  return (
    <div className="overlay" ref={ov} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" ref={box} tabIndex={-1} role={alert ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby={labelledBy}>
        <div className="modal-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
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
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [text, onDone]);
  useExitGhost(ref);
  return <div className="toast" role="status" ref={ref}>{text}</div>;
}

export function Meter({ pct, color, tick = true }: { pct: number; color?: string; tick?: boolean }) {
  const c = color ?? (pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--s1)');
  return <div className="meter"><div style={{ width: Math.min(100, pct) + '%', background: c }} />{tick && <span className="tick" title="80% alert" />}</div>;
}

export function budgetColor(p: number) { return p >= 100 ? 'var(--red)' : p >= 80 ? 'var(--amber)' : 'var(--s1)'; }

/** Bar spacing, value-label visibility and x-label thinning from the measured plot width (no breakpoint needed). */
function useBarLayout(n: number) {
  const ref = useRef<HTMLDivElement>(null);
  const w = useElementWidth(ref);
  const slot = w > 0 ? w / Math.max(1, n) : 60;
  const gap = Math.round(Math.max(2, Math.min(12, slot * 0.2)));
  const k = w > 0 ? Math.max(1, Math.ceil((n * 40) / w)) : 1;
  const labelOn = (i: number) => i === n - 1 || (i % k === 0 && n - 1 - i >= k);
  return { ref, gap, showValues: slot >= 32, labelOn };
}

/** Roving-tabindex focus across chart marks (one Tab stop per chart; arrows / Home / End move). */
function useRoving(n: number) {
  const [cur, setCur] = useState<number | null>(null);
  const [tab, setTab] = useState(Math.max(0, n - 1));
  const refs = useRef<(HTMLElement | null)[]>([]);
  const move = (i: number) => { const j = Math.max(0, Math.min(n - 1, i)); setTab(j); setCur(j); refs.current[j]?.focus(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); move(tab + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(tab - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(n - 1); }
  };
  const item = (i: number) => ({
    ref: (el: HTMLElement | null) => { refs.current[i] = el; },
    tabIndex: i === Math.min(tab, n - 1) ? 0 : -1,
    onFocus: () => { setTab(i); setCur(i); }, onMouseEnter: () => setCur(i), onClick: () => setCur(i),
  });
  return { cur, move, onKeyDown, item };
}

const chartId = (name: string) => 'chart:' + (typeof window !== 'undefined' ? window.location.hash.split('?')[0] : '') + ':' + name;

export function StackedBars({ data, labelFmt, label = 'Daily spend' }: { data: { label: string; claude: number; codex: number }[]; labelFmt?: (v: number) => string; label?: string }) {
  const max = Math.max(0.01, ...data.map((d) => d.claude + d.codex));
  const f = labelFmt ?? ((v: number) => '$' + (v >= 100 ? Math.round(v) : v.toFixed(1)));
  const L = useBarLayout(data.length);
  const R = useRoving(data.length);
  const anim = useFirstRender(chartId(label));
  const text = (d: (typeof data)[number]) => `${d.label}: Claude Code ${f(d.claude)}, Codex ${f(d.codex)}`;
  return (
    <>
      <div className={'bars' + (anim ? ' anim' : '')} ref={L.ref} role="group" aria-label={label} onKeyDown={R.onKeyDown} style={{ gap: L.gap }}>
        {data.map((d, i) => (
          <div className="b" key={i} role="img" aria-label={text(d)} data-on={R.cur === i || undefined} {...R.item(i)}>
            <span className="v" aria-hidden="true" style={L.showValues ? undefined : { visibility: 'hidden' }}>{d.claude + d.codex > 0 ? f(d.claude + d.codex) : ''}</span>
            <div className="stack" style={{ '--i': i } as React.CSSProperties}>
              <div style={{ height: `calc(var(--plot) * ${d.codex / max})`, background: 'var(--s2)', borderRadius: '6px 6px 0 0' }} />
              <div style={{ height: `max(${d.claude > 0 ? 2 : 0}px, calc(var(--plot) * ${d.claude / max}))`, background: 'var(--s1)', borderRadius: d.codex > 0 ? '0 0 3px 3px' : '6px 6px 3px 3px' }} />
            </div>
          </div>
        ))}
      </div>
      <div className="bar-labels" aria-hidden="true" style={{ gap: L.gap }}>{data.map((d, i) => <span key={i} style={L.labelOn(i) ? undefined : { visibility: 'hidden' }}>{d.label}</span>)}</div>
      <div className="chart-readout" aria-live="polite">{R.cur != null && data[R.cur] ? text(data[R.cur]) : ''}</div>
      <div className="sr-only"><table><caption>{label}</caption><thead><tr><th scope="col">Day</th><th scope="col">Claude Code</th><th scope="col">Codex</th></tr></thead>
        <tbody>{data.map((d, i) => <tr key={i}><th scope="row">{d.label}</th><td>{f(d.claude)}</td><td>{f(d.codex)}</td></tr>)}</tbody></table></div>
    </>
  );
}

/** Single-series bars (e.g. daily active members): same spacing, thinning, readout and grow-in as StackedBars. */
export function SimpleBars({ data, label, valueLabel }: { data: { label: string; value: number }[]; label: string; valueLabel: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const L = useBarLayout(data.length);
  const R = useRoving(data.length);
  const anim = useFirstRender(chartId(label));
  const text = (d: (typeof data)[number]) => `${d.label}: ${d.value}`;
  return (
    <>
      <div className={'bars bars-sm' + (anim ? ' anim' : '')} ref={L.ref} role="group" aria-label={label} onKeyDown={R.onKeyDown} style={{ gap: L.gap }}>
        {data.map((d, i) => (
          <div className="b" key={d.label + i} role="img" aria-label={text(d)} data-on={R.cur === i || undefined} {...R.item(i)}>
            <span className="v" aria-hidden="true" style={L.showValues ? undefined : { visibility: 'hidden' }}>{d.value}</span>
            <div className="stack" style={{ '--i': i } as React.CSSProperties}><div style={{ height: `calc(var(--plot) * ${d.value / max})`, background: 'var(--s1)', borderRadius: '6px 6px 2px 2px' }} /></div>
          </div>
        ))}
      </div>
      <div className="chart-readout" aria-live="polite">{R.cur != null && data[R.cur] ? text(data[R.cur]) : ''}</div>
      <div className="sr-only"><table><caption>{label}</caption><thead><tr><th scope="col">Day</th><th scope="col">{valueLabel}</th></tr></thead>
        <tbody>{data.map((d, i) => <tr key={i}><th scope="row">{d.label}</th><td>{d.value}</td></tr>)}</tbody></table></div>
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
  const ref = useRef<HTMLDivElement>(null);
  const w = useElementWidth(ref);
  // C5: if two-hour cells would be narrower than 12 px, show six four-hour blocks (max of each pair)
  const cols = rows[0]?.length ?? 12;
  const coarse = w > 0 && (w - 36 - (cols - 1) * 2) / cols < 12;
  const grid = coarse ? rows.map((r) => Array.from({ length: Math.ceil(r.length / 2) }, (_, j) => Math.max(r[2 * j] ?? 0, r[2 * j + 1] ?? 0))) : rows;
  const span = coarse ? 4 : 2;
  const per = grid[0]?.length ?? 1;
  const flat = grid.flatMap((r, i) => r.map((lv, j) => ({ i, j, lv })));
  const R = useRoving(flat.length);
  const name = (i: number, j: number) => `${days[i]} ${j * span}:00–${j * span + span}:00`;
  const onKey = (e: React.KeyboardEvent) => {
    const at = Number((document.activeElement as HTMLElement | null)?.dataset.idx ?? -1);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && at >= 0) {
      e.preventDefault();
      const next = at + (e.key === 'ArrowDown' ? per : -per);
      if (next >= 0 && next < flat.length) R.move(next);
      return;
    }
    R.onKeyDown(e);
  };
  return (
    <div className="heat" ref={ref}>
      <div role="group" aria-label="Active time by weekday and two-hour block" onKeyDown={onKey} className="heat-grid">
        {grid.map((r, i) => (
          <div className="hr" key={i}><span aria-hidden="true">{days[i]}</span>{r.map((lv, j) => { const k = i * per + j; return <div key={j} className="c" role="img" aria-label={name(i, j)} data-idx={k} data-on={R.cur === k || undefined} {...R.item(k)} style={{ background: `var(--heat${lv})` }} />; })}</div>
        ))}
      </div>
      <div className="heat-axis" aria-hidden="true">{coarse ? <><span style={{ flex: 2 }}>12a</span><span style={{ flex: 2 }}>8a</span><span style={{ flex: 2 }}>4p</span></> : <><span style={{ flex: 3 }}>12a</span><span style={{ flex: 3 }}>6a</span><span style={{ flex: 3 }}>12p</span><span style={{ flex: 3 }}>6p</span></>}</div>
      <div className="chart-readout" aria-live="polite">{R.cur != null && flat[R.cur] ? <><i style={{ background: `var(--heat${flat[R.cur].lv})` }} />{name(flat[R.cur].i, flat[R.cur].j)}</> : ''}</div>
      <div className="sr-only"><table><caption>Active time by weekday and two-hour block</caption><thead><tr><th scope="col">Day</th>{grid[0]?.map((_, j) => <th key={j} scope="col">{j * span}:00</th>)}</tr></thead>
        <tbody>{grid.map((r, i) => <tr key={i}><th scope="row">{days[i]}</th>{r.map((lv, j) => <td key={j}>{lv}</td>)}</tr>)}</tbody></table></div>
    </div>
  );
}

export function ShareRows({ rows }: { rows: { name: string; share: number; right: string; color?: string }[] }) {
  return (
    <>
      {rows.map((m) => (
        <div key={m.name} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <div className="share-head"><span className="share-name" title={m.name}>{m.name}</span><span className="mono text2 share-val">{m.right}</span></div>
          <div className="meter"><div style={{ width: Math.min(100, m.share) + '%', background: m.color ?? 'var(--s1)' }} /></div>
        </div>
      ))}
    </>
  );
}

/**
 * Horizontal scroll container for wide tables: keyboard-scrollable (focusable only while it actually scrolls),
 * labelled region, right-edge fade while more content is hidden, optional sticky first column.
 */
export function TableScroll({ label, sticky, children }: { label: string; sticky?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [s, setS] = useState({ scrollable: false, start: true, end: true });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const upd = () => {
      const next = { scrollable: el.scrollWidth > el.clientWidth + 1, start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 };
      setS((p) => (p.scrollable === next.scrollable && p.start === next.start && p.end === next.end ? p : next));
    };
    upd();
    el.addEventListener('scroll', upd, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(upd) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => { el.removeEventListener('scroll', upd); ro?.disconnect(); };
  }, []);
  return (
    <div className={'scroll-x' + (s.scrollable && !s.end ? ' more-right' : '')}>
      <div ref={ref} className={'table-wrap' + (sticky ? ' sticky-first' : '') + (!s.start ? ' scrolled' : '')} role="region" aria-label={label} tabIndex={s.scrollable ? 0 : undefined}>{children}</div>
    </div>
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
  const card = useRef<HTMLDivElement>(null);
  const docked = useMedia(mq.below('md')); // C9: phones get a card docked at the bottom
  const step = steps[i];
  const clear = () => {
    document.querySelectorAll('.tour-target').forEach((e) => e.classList.remove('tour-target'));
    document.querySelectorAll('.tour-raise').forEach((e) => e.classList.remove('tour-raise'));
  };
  const finish = () => { clear(); onDone(); };
  // D6: keyboard stays in the card, Escape closes, focus returns to what opened the tour
  useFocusTrap(card, true, { onEscape: finish, initial: () => card.current?.querySelector<HTMLElement>('.btn-primary') });
  useEffect(() => {
    setPos(null);
    const hidden = (e: HTMLElement) => { const r = e.getBoundingClientRect(); return r.width < 1 || r.height < 1 || r.right <= 0 || r.left >= window.innerWidth || getComputedStyle(e).visibility === 'hidden'; };
    let el = document.querySelector(`[data-tour="${step.target}"]`) as HTMLElement | null;
    if (el && hidden(el)) el = document.querySelector('.menu-btn') as HTMLElement | null; // D3: sidebar is a closed drawer
    if (el && hidden(el)) el = null;
    clear();
    const vw = () => document.documentElement.clientWidth;
    if (!el) { const t0 = setTimeout(() => setPos({ top: 120, left: Math.max(16, vw() / 2 - 170) }), 0); return () => clearTimeout(t0); }
    const target = el;
    target.classList.add('tour-target');
    target.closest('.topbar, .side')?.classList.add('tour-raise'); // D4: lift the sticky bar above the dim layer
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (docked) window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - 88), behavior });
    else target.scrollIntoView({ block: 'center', behavior });
    const place = () => {
      const r = target.getBoundingClientRect();
      const ch = card.current?.offsetHeight || 220, cw = card.current?.offsetWidth || 340, vh = window.innerHeight;
      const left = Math.min(Math.max(16, r.left), vw() - cw - 16);
      let top = r.bottom + 12 + ch <= vh - 16 ? r.bottom + 12 : r.top - 12 - ch;
      top = Math.min(Math.max(16, top), vh - ch - 16);
      setPos({ top, left });
    };
    const t = setTimeout(place, prefersReducedMotion() ? 0 : 320);
    window.addEventListener('resize', place);
    return () => { clearTimeout(t); window.removeEventListener('resize', place); target.classList.remove('tour-target'); target.closest('.topbar, .side')?.classList.remove('tour-raise'); };
  }, [step, docked]);
  useEffect(() => { if (pos) card.current?.querySelector<HTMLElement>('.btn-primary')?.focus({ preventScroll: true }); }, [pos, i]);
  return (
    <>
      <div className="tour-dim" onClick={finish} />
      <div ref={card} key={i} className={'tour-card' + (docked ? ' docked' : '') + (pos ? ' shown' : '')} role="dialog" aria-modal="true" aria-label="Product tour"
        style={pos ? (docked ? undefined : { top: pos.top, left: pos.left }) : { visibility: 'hidden', top: 0, left: 0 }}>
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
        <div className="auth-head-links">
          <a href={landing + '#pricing'} target="_blank" rel="noreferrer" className="btn btn-ghost auth-link-pricing">Pricing</a>
          <a href={landing + '#demo'} target="_blank" rel="noreferrer" className="btn btn-ghost auth-link-demo">Book a demo</a>
          <a href={landing} target="_blank" rel="noreferrer" className="btn btn-ghost auth-link-site">aknologia.com <Icon name="ext" size={14} /></a>
          <ThemeToggle theme={theme} onToggle={onTheme} />
        </div>
      </header>
      <main className="auth-main">
        <div className="auth-card">
          <div className="ribbon"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="lock" size={14} />SECURE SIGN-IN</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--green)' }} />INVITE-ONLY</span></div>
          {children}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px 26px', fontSize: 13, textAlign: 'center' }} className="text2">
          {[['shield', 'Only token counts and timestamps are shared'], ['lock', 'Prompts and code stay on your device'], ['mail', 'Invite-only access']].map(([i, t]) => <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ color: 'var(--accent-ink)' }}><Icon name={i} size={16} /></span>{t}</span>)}
        </div>
        <span className="text2" style={{ fontSize: 14, textAlign: 'center' }}>New to Aknologia? <a href={landing + '#pricing'} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>See pricing</a> or <a href={landing + '#demo'} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>book a demo</a></span>
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
