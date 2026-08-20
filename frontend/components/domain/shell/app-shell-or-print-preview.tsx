'use client';

import { Fragment, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Sidebar } from '@/components/domain/shell/sidebar';
import { Topbar } from '@/components/domain/shell/topbar';
import { ImpersonationBanner } from '@/components/domain/shell/impersonation-banner';
import { TrainingOverlay } from '@/components/domain/training/training-overlay';
import { TrainingWelcomeBanner } from '@/components/domain/training/training-welcome-banner';
import { Button } from '@/components/ui/button';

/**
 * `?print=1` on any page opens a bare version of that SAME route — no
 * sidebar/topbar/training UI, just the page's own content — in place of
 * the normal shell. Paired with PrintArea's `forceVisible` (print-area.tsx):
 * a "Переглянути" button next to a print button opens this same URL with
 * `print=1` via `window.open(..., '_blank')`, giving a real new-tab preview
 * of the exact printable markup already built into the page, without
 * duplicating any of that page's data-fetching/rendering logic into a
 * second route — the alternative the print-area.tsx header comment
 * explicitly says the legacy `document.write()`-into-`window.open()`
 * approach was moved away from.
 */
export function AppShellOrPrintPreview({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const isPrintPreview = searchParams.get('print') === '1';

  if (isPrintPreview) {
    return (
      <main className="print-preview-mode min-h-screen bg-white text-black">
        <PrintPreviewToolbar />
        <div className="overflow-x-auto p-6">{children}</div>
      </main>
    );
  }

  return (
    <Fragment>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <ImpersonationBanner />
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
        </div>
      </div>
      <TrainingOverlay />
      <TrainingWelcomeBanner />
    </Fragment>
  );
}

/**
 * P0 fix (2026-08-21): `?print=1` opens in a brand-new tab (PreviewButton's
 * `window.open(..., '_blank', 'noopener')`) with no app chrome at all — on
 * desktop the browser's own tab bar is enough to switch back, but on mobile
 * (no visible tab bar) that tab was a dead end with no way back into the
 * app. `window.close()` works here despite `noopener` — that flag only
 * hides `window.opener` from the new tab, it doesn't revoke the tab's own
 * "opened by script" permission to close itself. Some mobile browsers still
 * refuse it anyway (e.g. if the user later navigated within the tab), so
 * the fallback strips `?print=1` and turns this same tab into a normal,
 * fully-chromed in-app page instead of leaving a dead end.
 */
function PrintPreviewToolbar() {
  const t = useTranslations('print');

  function goBack() {
    window.close();
    setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete('print');
      window.location.href = url.toString();
    }, 300);
  }

  return (
    <div className="no-print sticky top-0 z-50 flex justify-end border-b border-gray-200 bg-gray-100 p-2">
      <Button type="button" variant="outline" size="sm" onClick={goBack}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        {t('backToAppAction')}
      </Button>
    </div>
  );
}
