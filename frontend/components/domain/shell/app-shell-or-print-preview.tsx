'use client';

import { Fragment, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { Sidebar } from '@/components/domain/shell/sidebar';
import { Topbar } from '@/components/domain/shell/topbar';
import { TrainingOverlay } from '@/components/domain/training/training-overlay';
import { TrainingWelcomeBanner } from '@/components/domain/training/training-welcome-banner';

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
    return <main className="print-preview-mode min-h-screen bg-white p-6 text-black">{children}</main>;
  }

  return (
    <Fragment>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
        </div>
      </div>
      <TrainingOverlay />
      <TrainingWelcomeBanner />
    </Fragment>
  );
}
