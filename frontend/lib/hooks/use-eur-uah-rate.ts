'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'sh-erp-eur-uah-rate';

/**
 * "Курс EUR → UAH" (2026-09-16 user request) — a rate staff types in right
 * before printing payroll, so the printed document can show earned amounts
 * in hryvnia alongside the app's own EUR figures. Persisted to localStorage
 * (same try/catch-around-storage convention as theme-provider.tsx) so it
 * survives across separate print sessions — a rate doesn't change every
 * print, re-typing it every time would be real friction. Each call site
 * reads its own copy at mount; two instances open on the same page at once
 * won't live-sync a mid-session edit between them (an accepted tradeoff —
 * the rate is filled in right where it's about to be used, not edited from
 * two places simultaneously in practice).
 */
export function useEurUahRate(): [number | null, (next: number | null) => void] {
  const [rate, setRateState] = useState<number | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = Number(stored);
        if (Number.isFinite(parsed) && parsed > 0) setRateState(parsed);
      }
    } catch {
      // Storage can throw in private-browsing/quota-exceeded edge cases — rate just won't persist.
    }
  }, []);

  function setRate(next: number | null) {
    setRateState(next);
    try {
      if (next == null) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Not worth surfacing to the user.
    }
  }

  return [rate, setRate];
}
