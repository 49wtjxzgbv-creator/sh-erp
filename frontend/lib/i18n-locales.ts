/**
 * Locale constants only, no `next/headers` import — split out of i18n.ts so
 * client components (e.g. the language switcher) can import just these
 * without dragging a server-only module into the client bundle graph.
 */
export const locales = ['uk', 'en', 'pl', 'de'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'uk';
export const LOCALE_COOKIE_NAME = 'sh_locale';
