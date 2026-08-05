'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n';

/**
 * AI voice mode (production-readiness pass, owner's priority #4 of 4) — mic
 * input + spoken replies for `/ai/full-assistant`. Built entirely on the
 * browser's native Web Speech API (`SpeechRecognition`/`speechSynthesis`),
 * not a new backend feature: `askFullAssistant`'s text-in/text-out contract
 * is completely unchanged, this is purely an input/output layer in front of
 * it (fills the existing question textarea from speech, optionally reads
 * the existing answer text aloud) — confirmed by reading
 * `app/(app)/ai/full-assistant/page.tsx` and `lib/api-client/ai.ts` in full
 * before starting, same discipline as every other item in this build order.
 *
 * No legacy source exists to port from — the Google Apps Script system's
 * `AI_FullAssistant.gs`/its HTML never had a voice feature (confirmed by
 * grepping `JavaScript.html`/`AI_FullAssistant.gs` for "speech"/"voice"/
 * "audio"/"microphone"/"мовлення"/"голос" during the earlier production-
 * readiness parity review — zero matches). This is new capability, not a
 * port, which is why the owner explicitly called it out as a "secondary
 * feature" requiring a decision rather than an auto-fix gap.
 *
 * `SpeechRecognition`/`SpeechSynthesis` have no official TypeScript DOM lib
 * types (still non-standardized across browsers — Safari/Firefox support is
 * inconsistent, confirmed via feature-detection below rather than assumed).
 * Minimal ambient types for just the surface this file uses are declared
 * here rather than pulling in a `@types/dom-speech-recognition`-style
 * package for a handful of fields.
 */

interface MinimalSpeechRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface MinimalSpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<MinimalSpeechRecognitionResult>;
}
interface MinimalSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: MinimalSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getSpeechRecognitionCtor(): (new () => MinimalSpeechRecognition) | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
}

/** BCP-47 tag per app locale — improves recognition/synthesis accuracy over letting the browser guess from its own UI language, which may not match the company's chosen locale. */
export const SPEECH_LANG_BY_LOCALE: Record<Locale, string> = {
  uk: 'uk-UA',
  en: 'en-US',
  pl: 'pl-PL',
  de: 'de-DE',
};

export function speechLangForLocale(locale: Locale): string {
  return SPEECH_LANG_BY_LOCALE[locale] ?? 'en-US';
}

export interface UseSpeechRecognitionOptions {
  lang: string;
  /** Called with the growing transcript on every interim AND final result — caller decides what to do with partial vs. final text via `isFinal`. */
  onResult: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
}

/**
 * Wraps native `SpeechRecognition`. Deliberately NOT auto-submitting on a
 * final result — the transcribed text lands in the existing question
 * textarea for the user to review/correct before sending, same
 * "hand-correct before committing" pattern this project already uses for
 * printed pick-list quantities and Excel import rows, rather than trusting
 * speech-to-text blindly on a business system.
 */
export function useSpeechRecognition({ lang, onResult, onError }: UseSpeechRecognitionOptions) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<MinimalSpeechRecognition | null>(null);
  const Ctor = getSpeechRecognitionCtor();
  const supported = Boolean(Ctor);

  const start = useCallback(() => {
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let transcript = '';
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        transcript += result[0].transcript;
        if (result.isFinal) isFinal = true;
      }
      onResult(transcript, isFinal);
    };
    recognition.onerror = (event) => {
      setListening(false);
      onError?.(event.error);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [Ctor, lang, onResult, onError]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  return { supported, listening, start, stop };
}

export interface UseSpeechSynthesisOptions {
  lang: string;
}

/** Wraps native `speechSynthesis`. Cancels any in-flight utterance before starting a new one — without this, rapid consecutive assistant replies would queue up and read out of order relative to what's on screen. */
export function useSpeechSynthesis({ lang }: UseSpeechSynthesisOptions) {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [supported, lang],
  );

  const cancel = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  useEffect(() => () => { if (supported) window.speechSynthesis.cancel(); }, [supported]);

  return { supported, speaking, speak, cancel };
}
