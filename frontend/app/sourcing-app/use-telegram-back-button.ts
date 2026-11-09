'use client';

import { useEffect } from 'react';
import { getTelegramWebApp } from './telegram-webapp';

/** Shows Telegram's own native back arrow (top-left, outside the page content) on a drill-down screen — e.g. inside a category's product list — instead of an in-page "← Назад" link, matching the native pattern the Mini App UX research called for. */
export function useTelegramBackButton(onBack: () => void) {
  useEffect(() => {
    const webApp = getTelegramWebApp();
    if (!webApp) return;
    webApp.BackButton.show();
    webApp.BackButton.onClick(onBack);
    return () => {
      webApp.BackButton.hide();
      webApp.BackButton.offClick(onBack);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onBack is expected to be stable per mount (router.back()); re-subscribing on every render would double-fire clicks
  }, []);
}
