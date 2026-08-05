import { speechLangForLocale, SPEECH_LANG_BY_LOCALE } from './use-speech';

/**
 * `useSpeechRecognition`/`useSpeechSynthesis` themselves wrap browser-only
 * `SpeechRecognition`/`speechSynthesis` globals that don't exist in jsdom —
 * consistent with this project's established pattern (see
 * `product-labels-dialog.test.ts`, `product-grid-columns.test.ts`), only the
 * pure, extractable logic is unit-tested here.
 */
describe('speechLangForLocale', () => {
  it('maps every supported app locale to its BCP-47 speech tag', () => {
    expect(speechLangForLocale('uk')).toBe('uk-UA');
    expect(speechLangForLocale('en')).toBe('en-US');
    expect(speechLangForLocale('pl')).toBe('pl-PL');
    expect(speechLangForLocale('de')).toBe('de-DE');
  });

  it('covers every locale in SPEECH_LANG_BY_LOCALE with no gaps', () => {
    const locales = Object.keys(SPEECH_LANG_BY_LOCALE);
    expect(locales.sort()).toEqual(['de', 'en', 'pl', 'uk']);
  });
});
