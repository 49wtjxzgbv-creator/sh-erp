'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'sh-erp-theme';

/**
 * Lightweight, dependency-free light/dark theme provider (2026-08-05 Landing
 * Page pass). Deliberately not `next-themes` — this app has no animation/UI
 * library dependency for theming today, and the entire mechanism is ~30
 * lines: toggle a `.dark` class on <html>, persist to localStorage, fall
 * back to the OS preference on first visit. The flash-of-wrong-theme problem
 * this kind of client-only provider normally has is avoided by the inline
 * blocking script in app/layout.tsx's <head> (see ThemeInitScript below),
 * which sets the class before hydration runs at all.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('dark');

  useEffect(() => {
    const root = document.documentElement;
    setThemeState(root.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    const root = document.documentElement;
    root.classList.toggle('dark', next === 'dark');
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can throw in private-browsing/quota-exceeded edge cases —
      // theme just won't persist across reloads, not worth surfacing to the user.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

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
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if (theme === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;
