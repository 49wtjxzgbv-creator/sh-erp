import type { Locale } from '@/lib/i18n-locales';

/**
 * On-demand client-side loader for ANOTHER locale's full messages file —
 * for a sub-tree that needs to render in a language different from the
 * logged-in user's own ambient UI locale (i18n.ts's own server-side
 * `NextIntlClientProvider`), e.g. a print preview the staff member is
 * generating in German for a German supplier while continuing to work in
 * Ukrainian themselves. Wrap the sub-tree in its own nested
 * `<NextIntlClientProvider locale={altLocale} messages={await
 * loadLocaleMessages(altLocale)}>` — next-intl's own documented pattern for
 * a locale override scoped to part of a tree. The dynamic `import()` below
 * is statically analyzable (a template literal over the fixed `./messages/
 * *.json` directory), so webpack code-splits one chunk per locale instead
 * of bundling all four into every page that might need this.
 */
export async function loadLocaleMessages(locale: Locale) {
  return (await import(`../messages/${locale}.json`)).default;
}
