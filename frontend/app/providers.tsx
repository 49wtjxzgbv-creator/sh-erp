'use client';

import { useState } from 'react';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/lib/hooks/use-toast';
import { ApiError } from '@/lib/api-client/types';

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
 * Client-side providers only. NextIntlClientProvider is set up in
 * app/layout.tsx (a Server Component) since it needs the server-resolved
 * locale/messages from next-intl's getRequestConfig (i18n.ts) — nesting it
 * here would lose that.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  // Constructed once per browser session via useState's lazy initializer,
  // not per render — a fresh QueryClient per render would drop all cached
  // data and in-flight query state on every re-render of this provider.
  const [queryClient] = useState(
    () =>
      new QueryClient({
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
            const message = error instanceof ApiError ? error.message : 'Щось пішло не так. Спробуйте ще раз.';
            toast.error(message);
          },
          onSuccess: (_data, _vars, _ctx, mutation) => {
            if (mutation.meta?.successMessage) toast.success(mutation.meta.successMessage);
          },
        }),
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {children}
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
