'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/** `system` is now a real, persisted third choice — not just a first-visit fallback. */
export type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  /** The user's actual selection — may be `system`. */
  theme: Theme;
  /** What's actually applied right now (`system` resolved against the OS). Use this to render icon state. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'sh-erp-theme';

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

/**
 * Lightweight, dependency-free light/dark/system theme provider (2026-08-05
 * Landing Page pass, extended 2026-08-14 with a real `system` mode).
 * Deliberately not `next-themes` — the whole mechanism stays under 60 lines:
 * persist the user's choice to localStorage, toggle a `.dark` class on
 * <html>, and when the choice is `system`, track `matchMedia` live so the
 * app follows an OS-level theme change without a reload. The
 * flash-of-wrong-theme problem this kind of client-only provider normally
 * has is avoided by the inline blocking script in app/layout.tsx's <head>
 * (see THEME_INIT_SCRIPT below), which sets the class before hydration runs
 * at all.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('dark');

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Storage can throw in private-browsing/quota-exceeded edge cases — falls through to 'system'.
    }
    const initial: Theme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    setThemeState(initial);
    setResolvedTheme(initial === 'system' ? getSystemTheme() : initial);
  }, []);

  useEffect(() => {
    if (theme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = getSystemTheme();
      setResolvedTheme(next);
      applyTheme(next);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    const resolved = next === 'system' ? getSystemTheme() : next;
    setResolvedTheme(resolved);
    applyTheme(resolved);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Theme just won't persist across reloads, not worth surfacing to the user.
    }
  }, []);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

/**
 * Inline script rendered directly in <head> (app/layout.tsx), before React
 * hydrates. Reads localStorage/OS preference synchronously and sets the
 * `.dark` class immediately — without this, the page would render in the
 * server-guessed default theme and then visibly flip once ThemeProvider's
 * effect runs on the client (a real flash-of-wrong-theme bug, not a
 * hypothetical one, on any client-only theme toggle).
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var choice = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    var theme = choice === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : choice;
    if (theme === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;
