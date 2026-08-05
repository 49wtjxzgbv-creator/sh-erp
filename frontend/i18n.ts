import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

/**
 * Supported locales (Phase 2 §3.6). `uk` is the complete, default catalogue —
 * the legacy Apps Script system was Ukrainian-only. en/pl/de are scaffolded
 * placeholders (keys present, many values still mirror the English/uk source)
 * so the message-key surface is stable for translators to fill in later.
 */
export const locales = ['uk', 'en', 'pl', 'de'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'uk';
export const LOCALE_COOKIE_NAME = 'sh_locale';

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
