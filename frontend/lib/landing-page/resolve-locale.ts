import { cookies } from 'next/headers';
import { locales, defaultLocale, LOCALE_COOKIE_NAME, type Locale } from '@/lib/i18n-locales';

/** Server-side locale resolution for the public landing page — reuses the exact same cookie i18n.ts already reads, no new locale mechanism. */
export function resolveLocale(): Locale {
  const cookieLocale = cookies().get(LOCALE_COOKIE_NAME)?.value;
  return (locales as readonly string[]).includes(cookieLocale ?? '') ? (cookieLocale as Locale) : defaultLocale;
}
