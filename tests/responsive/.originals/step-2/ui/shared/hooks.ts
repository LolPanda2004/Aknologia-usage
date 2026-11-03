import { useCallback, useEffect, useState, type RefObject } from 'react';
import { MOTION } from './breakpoints';

export type Theme = 'dark' | 'light';

/** True while `query` matches; follows changes (window resize, OS settings). */
export function useMedia(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && !!window.matchMedia?.(query).matches);
  const [on, setOn] = useState(get);
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const f = () => setOn(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [query]);
  return on;
}

export const usePrefersReducedMotion = () => useMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Ids of data-driven animations (bars grow, line reveal, KPI count-up) that already ran in this page load.
const played = new Set<string>();
/**
 * True on the first render of `id` in this page load, false afterwards (and always false with reduced motion).
 * The id is marked after a timer, so React StrictMode's dev double-mount doesn't consume it; re-renders, polls
 * and navigating back never replay the animation.
 */
export function useFirstRender(id: string): boolean {
  const [first, setFirst] = useState(() => !played.has(id) && !prefersReducedMotion());
  useEffect(() => {
    if (!first) return;
    const t = setTimeout(() => { played.add(id); setFirst(false); }, 1000);
    return () => clearTimeout(t);
  }, [id, first]);
  return first;
}

/** Content-box width of an element, kept current with a ResizeObserver. */
export function useElementWidth(ref: RefObject<HTMLElement>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((es) => { const cw = Math.round(es[0].contentRect.width); setW((p) => (p === cw ? p : cw)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Smooth colour cross-fade for a user-initiated theme switch only (never on first load or OS-driven changes). */
let themeAnimTimer: ReturnType<typeof setTimeout> | undefined;
function animateThemeSwitch() {
  if (prefersReducedMotion()) return;
  const html = document.documentElement;
  html.classList.add('theme-anim');
  clearTimeout(themeAnimTimer);
  themeAnimTimer = setTimeout(() => html.classList.remove('theme-anim'), MOTION.page + 40);
}

/** Theme follows the OS until the user picks one; the choice is remembered on this device. */
export function useTheme(): [Theme, (t: Theme | 'system') => void, 'system' | Theme] {
  const stored = (localStorage.getItem('akn-theme') as Theme | null) ?? null;
  const sys = () => (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const [pref, setPref] = useState<'system' | Theme>(stored ?? 'system');
  const [theme, setTheme] = useState<Theme>(stored ?? sys());
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    const on = () => setTheme(sys());
    mq?.addEventListener('change', on);
    return () => mq?.removeEventListener('change', on);
  }, [pref]);
  const set = useCallback((t: Theme | 'system') => {
    animateThemeSwitch();
    setPref(t);
    if (t === 'system') {
      localStorage.removeItem('akn-theme');
      setTheme(sys());
    } else {
      localStorage.setItem('akn-theme', t);
      setTheme(t);
    }
  }, []);
  return [theme, set, pref];
}

/** Minimal hash router: #/path?query */
export function useRoute(): [string, URLSearchParams, (to: string) => void] {
  const read = () => {
    const h = window.location.hash.replace(/^#/, '') || '/';
    const [p, q] = h.split('?');
    return [p, new URLSearchParams(q ?? '')] as const;
  };
  const [r, setR] = useState(read());
  useEffect(() => {
    const on = () => setR(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = useCallback((to: string) => {
    window.location.hash = to;
  }, []);
  return [r[0], r[1], go];
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn()
      .then((d) => live && (setData(d), setError(null)))
      .catch((e) => live && setError(e.message ?? String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1), setData };
}
