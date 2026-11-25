'use client';

import { useEffect } from 'react';
import { getTelegramWebApp, isLargeScreenDevice } from './telegram-webapp';

/**
 * Typical height of Telegram's floating close/more-menu buttons in
 * fullscreen mode -- used as a FLOOR, not the real value, because a real
 * device tested 2026-11-25 reported `contentSafeAreaInset.top` as 0 while
 * visibly drawing those buttons over the content. Only applied when we
 * actually requested fullscreen (see isLargeScreenDevice) -- on a phone,
 * which never calls requestFullscreen(), this stays irrelevant.
 *
 * 2026-11-25, recalibrated from an iPad screenshot: 54px cleared our own
 * header text but was still too short for the sticky Категорії/Виробами
 * toggle right below it (page.tsx) to clear Telegram's "Закрити"/"..."
 * row -- bumped up with margin, since this is an estimate from one
 * screenshot, not a measured value.
 */
const FALLBACK_CONTENT_SAFE_AREA_TOP_PX = 110;

function applyContentSafeArea(top: number, bottom: number, fullscreenRequested: boolean) {
  const root = document.documentElement;
  root.style.setProperty('--tg-content-safe-area-top', `${fullscreenRequested ? Math.max(top, FALLBACK_CONTENT_SAFE_AREA_TOP_PX) : top}px`);
  root.style.setProperty('--tg-content-safe-area-bottom', `${bottom}px`);
}

/**
 * Mirrors `Telegram.WebApp.contentSafeAreaInset` onto `--tg-content-safe-
 * area-*` CSS custom properties, with a guaranteed floor for the top inset
 * whenever this route requested fullscreen (see this file's own constant
 * comment for why the floor exists -- Telegram's self-reported value can't
 * be trusted alone). Defaults to 0 outside Telegram or on an older client.
 *
 * `sdkReady` (2026-11-25 fix -- THE actual root cause of three straight
 * "nothing changed" reports on a real iPad, despite the deployed bundle
 * confirmed correct each time via direct curl of the server's own JS
 * chunk): `telegram-web-app.js` loads via `afterInteractive`, which can
 * resolve AFTER this hook's effect first runs on mount -- the old ungated
 * version saw `getTelegramWebApp() === null` on that first run, permanently
 * set the inset to 0 via the `!webApp` branch, and NEVER retried once the
 * SDK actually became available moments later (empty `[]` deps). No floor
 * value could ever have fixed this -- the branch that applies the floor was
 * simply never reached. Depending on `sdkReady` (set by the shell once
 * `Script`'s `onLoad` fires or the SDK is found already cached) re-runs this
 * effect at the moment the SDK is actually confirmed present.
 */
export function useTelegramSafeArea(sdkReady: boolean) {
  useEffect(() => {
    const fullscreenRequested = isLargeScreenDevice();
    const webApp = getTelegramWebApp();
    if (!webApp) {
      applyContentSafeArea(0, 0, false);
      return;
    }
    const apply = () => applyContentSafeArea(webApp.contentSafeAreaInset?.top ?? 0, webApp.contentSafeAreaInset?.bottom ?? 0, fullscreenRequested);
    apply();
    webApp.onEvent('contentSafeAreaChanged', apply);
    return () => webApp.offEvent('contentSafeAreaChanged', apply);
  }, [sdkReady]);
}
