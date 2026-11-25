'use client';

import { useEffect } from 'react';
import { getTelegramWebApp, TelegramThemeParams } from './telegram-webapp';

/** Falls back to a neutral light theme outside Telegram (plain browser visit while developing/debugging) — never a blank/unstyled page. */
const FALLBACK_THEME: Required<TelegramThemeParams> = {
  bg_color: '#ffffff',
  text_color: '#0f0f14',
  hint_color: '#6b7280',
  link_color: '#5b8def',
  button_color: '#5b8def',
  button_text_color: '#ffffff',
  secondary_bg_color: '#f4f4f7',
  header_bg_color: '#ffffff',
  accent_text_color: '#5b8def',
  section_bg_color: '#ffffff',
  destructive_text_color: '#e53e3e',
};

const CSS_VAR_BY_KEY: Record<keyof TelegramThemeParams, string> = {
  bg_color: '--tg-bg',
  text_color: '--tg-text',
  hint_color: '--tg-hint',
  link_color: '--tg-link',
  button_color: '--tg-button',
  button_text_color: '--tg-button-text',
  secondary_bg_color: '--tg-secondary-bg',
  header_bg_color: '--tg-header-bg',
  accent_text_color: '--tg-accent-text',
  section_bg_color: '--tg-section-bg',
  destructive_text_color: '--tg-destructive-text',
};

function applyTheme(theme: TelegramThemeParams) {
  const root = document.documentElement;
  for (const [key, cssVar] of Object.entries(CSS_VAR_BY_KEY) as Array<[keyof TelegramThemeParams, string]>) {
    root.style.setProperty(cssVar, theme[key] ?? FALLBACK_THEME[key]);
  }
}

/**
 * Mirrors `Telegram.WebApp.themeParams` onto `--tg-*` CSS custom properties
 * (2026-11-10) — this route's own Tailwind classes reference these tokens
 * (not the ERP's `--background`/`--primary` etc.) so the Mini App matches
 * whatever light/dark theme the user has set in Telegram itself, live,
 * including a switch mid-session (`themeChanged`).
 *
 * `sdkReady` (2026-11-25 fix — same root cause as useTelegramSafeArea's own
 * doc comment): `telegram-web-app.js` loads via `afterInteractive`, which
 * can resolve AFTER this hook's first effect run — a ungated check used to
 * see `getTelegramWebApp() === null`, fall back permanently, and never
 * retry once the SDK actually became available. Depending on `sdkReady`
 * re-runs this effect once the shell confirms the SDK is really there.
 */
export function useTelegramTheme(sdkReady: boolean) {
  useEffect(() => {
    const webApp = getTelegramWebApp();
    if (!webApp) {
      applyTheme(FALLBACK_THEME);
      return;
    }
    applyTheme(webApp.themeParams);
    const handler = () => applyTheme(webApp.themeParams);
    webApp.onEvent('themeChanged', handler);
    return () => webApp.offEvent('themeChanged', handler);
  }, [sdkReady]);
}
