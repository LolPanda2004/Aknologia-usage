import { useCallback, useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

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
