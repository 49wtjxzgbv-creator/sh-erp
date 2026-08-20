import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SessionBoundary } from '@/components/domain/shell/session-boundary';
import { MobileNavProvider } from '@/components/domain/shell/mobile-nav-context';
import { TrainingProvider } from '@/components/domain/training/training-provider';
import { COURSES } from '@/components/domain/training/courses';
import { AppShellOrPrintPreview } from '@/components/domain/shell/app-shell-or-print-preview';

/** Real customer data behind auth — never indexable, regardless of whether a crawler somehow gets past the sign-in redirect. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Authenticated shell (Phase 2 §3.1). Every route under app/(app)/ renders
 * inside this layout: sidebar + topbar chrome, gated by SessionBoundary
 * (which owns turning the httpOnly refresh cookie into an in-memory access
 * token before anything tries to call the backend). Tenant branding
 * (logo/accent override from CompanyBranding) is a later addition here —
 * not yet wired up, tracked for the Catalog+Settings module task since
 * that's where the branding-settings UI itself will live.
 *
 * Providers stay mounted unconditionally (SessionBoundary/MobileNavProvider/
 * TrainingProvider) — only the visible chrome (Sidebar/Topbar/Training
 * overlay/banner) is conditional on `?print=1`, decided inside
 * AppShellOrPrintPreview so the `useSearchParams()` read (which needs a
 * Suspense boundary — Next.js opts a page out of static rendering up to
 * the nearest one otherwise) stays scoped to one small client component
 * instead of the whole layout.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionBoundary>
      <MobileNavProvider>
        <TrainingProvider courses={COURSES}>
          <Suspense fallback={null}>
            <AppShellOrPrintPreview>{children}</AppShellOrPrintPreview>
          </Suspense>
        </TrainingProvider>
      </MobileNavProvider>
    </SessionBoundary>
  );
}
