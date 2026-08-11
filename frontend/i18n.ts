import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { locales, defaultLocale, LOCALE_COOKIE_NAME, type Locale } from '@/lib/i18n-locales';

export { locales, defaultLocale, LOCALE_COOKIE_NAME, type Locale };

/**
 * Deliberate adaptation, disclosed here: Phase 2 §3.1 specifies
 * `app/(public)/` + `app/(app)/` route groups, not a `app/[locale]/...`
 * dynamic segment. Rather than nest every route under `[locale]` (which
 * would fight that route-group structure and put locale in every URL for a
 * system whose tenancy is already slug/subdomain-based), locale is resolved
 * from a plain cookie set by the language switcher, never from the URL path.
 * This is next-intl's documented "without i18n routing" mode.
 */
export default getRequestConfig(async () => {
  const cookieLocale = cookies().get(LOCALE_COOKIE_NAME)?.value;
  const locale = (locales as readonly string[]).includes(cookieLocale ?? '')
    ? (cookieLocale as Locale)
    : defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
