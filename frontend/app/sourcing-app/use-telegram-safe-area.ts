'use client';

import { useEffect } from 'react';
import { getTelegramWebApp, TELEGRAM_FULLSCREEN_MIN_WIDTH } from './telegram-webapp';

/**
 * Typical height of Telegram's floating close/more-menu buttons in
 * fullscreen mode — used as a FLOOR, not the real value, because a real
 * device tested 2026-11-25 reported `contentSafeAreaInset.top` as 0 while
 * visibly drawing those buttons over the content. Only applied when we
 * actually requested fullscreen (see TELEGRAM_FULLSCREEN_MIN_WIDTH) — on a
 * phone, which never calls requestFullscreen(), this stays irrelevant.
 */
const FALLBACK_CONTENT_SAFE_AREA_TOP_PX = 54;

function applyContentSafeArea(top: number, bottom: number, fullscreenRequested: boolean) {
  const root = document.documentElement;
  root.style.setProperty('--tg-content-safe-area-top', `${fullscreenRequested ? Math.max(top, FALLBACK_CONTENT_SAFE_AREA_TOP_PX) : top}px`);
  root.style.setProperty('--tg-content-safe-area-bottom', `${bottom}px`);
}

/**
 * Mirrors `Telegram.WebApp.contentSafeAreaInset` onto `--tg-content-safe-
 * area-*` CSS custom properties, with a guaranteed floor for the top inset
 * whenever this route requested fullscreen (see this file's own constant
 * comment for why the floor exists — Telegram's self-reported value can't
 * be trusted alone). Defaults to 0 outside Telegram or on an older client.
 */
export function useTelegramSafeArea() {
  useEffect(() => {
    const fullscreenRequested = typeof window !== 'undefined' && window.innerWidth >= TELEGRAM_FULLSCREEN_MIN_WIDTH;
    const webApp = getTelegramWebApp();
    if (!webApp) {
      applyContentSafeArea(0, 0, false);
      return;
    }
    const apply = () => applyContentSafeArea(webApp.contentSafeAreaInset?.top ?? 0, webApp.contentSafeAreaInset?.bottom ?? 0, fullscreenRequested);
    apply();
    webApp.onEvent('contentSafeAreaChanged', apply);
    return () => webApp.offEvent('contentSafeAreaChanged', apply);
  }, []);
}
