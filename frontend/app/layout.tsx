import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Providers } from './providers';
import { THEME_INIT_SCRIPT } from '@/components/theme/theme-provider';
import './globals.css';

/**
 * Real production domain isn't purchased yet (Phase 0 decision: placeholder
 * until then) — `NEXT_PUBLIC_SITE_URL` lets a real deploy override this via
 * env without a code change; falls back to the documented placeholder so
 * `metadataBase`/OG absolute-URL resolution always has something valid to
 * work with even before that env var is set.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sh-erp.com';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'SH ERP — виробничий та складський облік для реального бізнесу',
    template: '%s · SH ERP',
  },
  description:
    'SH ERP — сучасна ERP-система для виробництва, складу, закупівель і продажів. Мультитенантна, швидка, з AI-асистентом. Почніть безкоштовно.',
  keywords: [
    'ERP',
    'виробничий облік',
    'складський облік',
    'управління виробництвом',
    'BOM',
    'облік запасів',
    'ERP система',
    'SH ERP',
  ],
  authors: [{ name: 'Shyring' }],
  applicationName: 'SH ERP',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
  },
  openGraph: {
    type: 'website',
    locale: 'uk_UA',
    url: SITE_URL,
    siteName: 'SH ERP',
    title: 'SH ERP — виробничий та складський облік для реального бізнесу',
    description:
      'Виробництво, склад, закупівлі, продажі, BOM, AI та звіти — в одній сучасній системі. Почніть безкоштовно за 2 хвилини.',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'SH ERP' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SH ERP — виробничий та складський облік для реального бізнесу',
    description: 'Виробництво, склад, закупівлі, продажі, BOM, AI та звіти — в одній сучасній системі.',
    images: ['/opengraph-image'],
  },
  robots: { index: true, follow: true },
  // Belt-and-suspenders with the <html translate="no"> below — this is the
  // Google-specific legacy signal, `translate="no"` the general HTML one.
  // Both exist because browser translate-crash reports (see that attribute's
  // own comment) don't agree on which one every Chrome build honors.
  other: { google: 'notranslate' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f0f13' },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  // translate="no": the app already ships real, human-translated copy for
  // every supported language via next-intl (see messages/*.json) — the
  // browser's own auto-translate has no legitimate reason to ever engage
  // here, and when it does it actively breaks the app. Confirmed live:
  // Chrome/Google Translate rewrites DOM text nodes outside React's
  // control, and when a Radix Select (portal-based) commits a change to
  // the same text at the same moment, React's reconciler tries to
  // remove/reposition a node the translator already moved — "NotFoundError:
  // Failed to execute 'removeChild' — not a child of this node", crashing
  // the whole page. Reproduced reliably on /catalog/new's Unit select (any
  // first real selection); a documented class of bug for portal-based UI
  // libraries (Radix, shadcn/ui) under browser translation.
  return (
    <html lang={locale} translate="no" suppressHydrationWarning>
      <head>
        {/* Sets the .dark class before hydration — avoids a flash of the wrong theme. See components/theme/theme-provider.tsx's own comment for why this can't just be a useEffect. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
