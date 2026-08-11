import { SessionBoundary } from '@/components/domain/shell/session-boundary';
import { Sidebar } from '@/components/domain/shell/sidebar';
import { Topbar } from '@/components/domain/shell/topbar';
import { MobileNavProvider } from '@/components/domain/shell/mobile-nav-context';

/**
 * Authenticated shell (Phase 2 §3.1). Every route under app/(app)/ renders
 * inside this layout: sidebar + topbar chrome, gated by SessionBoundary
 * (which owns turning the httpOnly refresh cookie into an in-memory access
 * token before anything tries to call the backend). Tenant branding
 * (logo/accent override from CompanyBranding) is a later addition here —
 * not yet wired up, tracked for the Catalog+Settings module task since
 * that's where the branding-settings UI itself will live.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionBoundary>
      <MobileNavProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children}</main>
          </div>
        </div>
      </MobileNavProvider>
    </SessionBoundary>
  );
}
