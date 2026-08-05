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

  return (
    <html lang={locale} suppressHydrationWarning>
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
