'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { getTelegramWebApp } from './telegram-webapp';
import { useTelegramTheme } from './use-telegram-theme';
import { useMe, isNotPairedError } from './use-sourcing-app';
import { NotPairedScreen } from './not-paired-screen';
import { Skeleton } from '@/components/ui/skeleton';
import { BottomTabBar } from './bottom-tab-bar';

/**
 * Root shell for the whole Mini App (2026-11-10 — "веб версію як
 * застосунок"). Deliberately shares NOTHING with `(app)`'s ERP chrome
 * (sidebar/topbar) — this route tree still inherits the real root
 * `app/layout.tsx` (html/body/fonts/i18n provider), just not the ERP's own
 * nested layout, same boundary `app/supplier-portal/` already draws.
 */
export function SourcingAppShell({ children }: { children: React.ReactNode }) {
  useTelegramTheme();

  const [sdkReady, setSdkReady] = useState(false);

  useEffect(() => {
    // The script may already be cached/loaded from a previous Script mount this session — onLoad alone would miss that case.
    if (getTelegramWebApp()) setSdkReady(true);
  }, []);

  useEffect(() => {
    if (!sdkReady) return;
    const webApp = getTelegramWebApp();
    webApp?.ready();
    webApp?.expand();
  }, [sdkReady]);

  const { data: me, isLoading, error } = useMe(sdkReady);
  const showLoading = !sdkReady || isLoading;

  return (
    <>
      {/* `beforeInteractive` is Next.js-reserved for the ROOT layout only — this is a nested layout (see this file's own header comment), so `afterInteractive` (loads as soon as the client bundle itself finishes) is the earliest strategy actually available here. `onLoad` gates the first API call (useMe below) until `window.Telegram.WebApp.initData` actually exists — calling before then would send an empty initData and spuriously 401. */}
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onLoad={() => setSdkReady(true)} />
      <div
        className="fixed inset-0 flex flex-col"
        style={{ background: 'var(--tg-bg)', color: 'var(--tg-text)' }}
      >
        {showLoading ? (
          <div className="flex-1 space-y-3 p-4">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : isNotPairedError(error) ? (
          <div className="flex-1">
            <NotPairedScreen />
          </div>
        ) : (
          <>
            <header className="shrink-0 border-b px-4 py-3" style={{ borderColor: 'color-mix(in srgb, var(--tg-hint) 20%, transparent)' }}>
              <p className="text-sm font-semibold">👋 {me?.fullName ?? 'Пошук постачальників'}</p>
            </header>
            <main className="flex-1 overflow-y-auto pb-16">{children}</main>
            <BottomTabBar />
          </>
        )}
      </div>
    </>
  );
}
