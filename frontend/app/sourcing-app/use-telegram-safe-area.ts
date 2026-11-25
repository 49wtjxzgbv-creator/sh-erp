'use client';

import { useEffect } from 'react';
import { getTelegramWebApp } from './telegram-webapp';

function applyContentSafeArea(top: number, bottom: number) {
  const root = document.documentElement;
  root.style.setProperty('--tg-content-safe-area-top', `${top}px`);
  root.style.setProperty('--tg-content-safe-area-bottom', `${bottom}px`);
}

/**
 * Mirrors `Telegram.WebApp.contentSafeAreaInset` onto `--tg-content-safe-
 * area-*` CSS custom properties (2026-11-25 user report, right after
 * `requestFullscreen()` shipped: "вгорі кнопка закрити і інші налазять на
 * кнопки нашого застосунку") — in fullscreen mode Telegram floats its OWN
 * close/more-menu buttons directly over the WebView content, a space
 * `env(safe-area-inset-top)` (the device notch, already handled elsewhere
 * in this route) knows nothing about. Defaults to 0 outside Telegram or on
 * an older client without this API — existing device-safe-area padding
 * stays the only inset in that case, same as before this fix.
 */
export function useTelegramSafeArea() {
  useEffect(() => {
    const webApp = getTelegramWebApp();
    if (!webApp) {
      applyContentSafeArea(0, 0);
      return;
    }
    const apply = () => applyContentSafeArea(webApp.contentSafeAreaInset?.top ?? 0, webApp.contentSafeAreaInset?.bottom ?? 0);
    apply();
    webApp.onEvent('contentSafeAreaChanged', apply);
    return () => webApp.offEvent('contentSafeAreaChanged', apply);
  }, []);
}
