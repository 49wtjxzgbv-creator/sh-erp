'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
