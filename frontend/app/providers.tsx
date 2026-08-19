'use client';

import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { toast } from '@/lib/hooks/use-toast';
import { useApiErrorMessage } from '@/lib/api-error-message';

/**
 * `MutationCache.onError` fires outside React rendering (a plain callback,
 * not a component), so it can't call `useApiErrorMessage()` — a hook —
 * directly. Deferring the actual translation to render time instead: this
 * tiny component is what gets stored as the toast's `description` (a
 * `React.ReactNode`, per use-toast.ts), and only resolves the code when
 * `<Toaster />` actually renders it — which happens inside
 * `NextIntlClientProvider` (app/layout.tsx), so the hook has a valid
 * context there. Same translation path as every other error display in the
 * app, just fired from a non-component callsite.
 */
function ApiErrorToastDescription({ error, fallback }: { error: unknown; fallback: string }) {
  const apiErrorMessage = useApiErrorMessage();
  return <>{apiErrorMessage(error, fallback)}</>;
}

/**
 * Extra per-mutation options every useMutation() in this app can pass via
 * TanStack Query's own `meta` field (untyped by default — this augments it).
 * Opt-in only: a mutation says nothing and gets the default (silent success,
 * global error toast); a mutation that already shows its own inline error
 * (e.g. the login/register forms) sets `suppressErrorToast` so the user
 * doesn't see the same failure twice.
 */
declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      successMessage?: string;
      suppressErrorToast?: boolean;
    };
  }
}

/**
 * A module-level singleton, not a `useState`-constructed instance inside
 * `Providers` — evaluated once per browser tab load either way, but a
 * plain export lets `lib/auth/actions.ts` (login/logout/restoreSession are
 * plain async functions, not hooks/components, so they can't call
 * `useQueryClient()`) reach in and clear it directly. That clear is the
 * fix for a real incident: nothing previously invalidated cached query
 * data across a login/logout inside the SAME browser tab, so switching
 * accounts (e.g. an admin testing a lower-privilege role, then logging
 * back in as themselves) kept serving the PREVIOUS account's cached
 * results under identical query keys — including permission-gated data
 * like photo URLs that had 403'd for the lower-privileged account and
 * stayed cached as empty/errored even after logging back into an account
 * that legitimately has access.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
  // Single place that turns "a mutation somewhere failed" into a
  // visible toast — before this, only forms with their own hand-rolled
  // `formError` state (login/register) surfaced errors at all; every
  // other create/update/delete across all 14 modules failed silently
  // from the user's point of view unless the page happened to render
  // `mutation.error` itself. Opt out per-mutation via
  // `meta: { suppressErrorToast: true }` for the handful of forms that
  // already show an inline error and would otherwise double up.
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.suppressErrorToast) return;
      toast.error(<ApiErrorToastDescription error={error} fallback="Щось пішло не так. Спробуйте ще раз." />);
    },
    onSuccess: (_data, _vars, _ctx, mutation) => {
      if (mutation.meta?.successMessage) toast.success(mutation.meta.successMessage);
    },
  }),
});

/**
 * Client-side providers only. NextIntlClientProvider is set up in
 * app/layout.tsx (a Server Component) since it needs the server-resolved
 * locale/messages from next-intl's getRequestConfig (i18n.ts) — nesting it
 * here would lose that.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
