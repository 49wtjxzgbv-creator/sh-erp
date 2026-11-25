'use client';

/**
 * Minimal typing for Telegram's `telegram-web-app.js` global (2026-11-10 —
 * "веб версію як застосунок"). Only the subset this Mini App actually
 * uses — see https://core.telegram.org/bots/webapps for the full API.
 */
export interface TelegramThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
  section_bg_color?: string;
  destructive_text_color?: string;
}

/** Bot API 8.0+ — insets in CSS px, only non-zero while the Mini App is actually running (empty object otherwise). */
export interface TelegramSafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string } };
  themeParams: TelegramThemeParams;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  close(): void;
  /** Device-level safe area (notch, home indicator) — same thing `env(safe-area-inset-*)` already covers via CSS, kept here only for completeness. */
  safeAreaInset?: TelegramSafeAreaInset;
  /**
   * 2026-11-25 user report ("вгорі кнопка закрити і інші налазять на кнопки
   * нашого застосунку" — right after `requestFullscreen()` shipped): in
   * fullscreen mode Telegram floats its OWN close/more-menu buttons directly
   * ON TOP of the WebView content, not above it — `env(safe-area-inset-top)`
   * (the device notch) knows nothing about this; THIS inset is specifically
   * the space Telegram's own floating chrome occupies, so any fixed header
   * must add it on top of the device safe area, not instead of it.
   */
  contentSafeAreaInset?: TelegramSafeAreaInset;
  /**
   * Bot API 8.0+ — on a phone, `expand()` already covers the full screen,
   * but on iPad/desktop Telegram clients it only expands within a
   * phone-sized modal window; THIS is the call that actually takes over
   * the whole screen there (2026-11-25 user report: "в телеграм постачальники
   * на айпаді відкривається в маленькому телефонному розмірі"). Optional —
   * older clients won't have it.
   */
  requestFullscreen?(): void;
  onEvent(event: 'themeChanged' | 'safeAreaChanged' | 'contentSafeAreaChanged', callback: () => void): void;
  offEvent(event: 'themeChanged' | 'safeAreaChanged' | 'contentSafeAreaChanged', callback: () => void): void;
  showAlert(message: string, callback?: () => void): void;
  showConfirm(message: string, callback: (confirmed: boolean) => void): void;
  openLink(url: string): void;
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  };
  BackButton: {
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
  /**
   * Bot API 7.7+ — Telegram's own vertical-swipe-to-minimize gesture
   * otherwise competes with any drag gesture inside the Mini App (2026-11-10
   * real user report: the 3D viewer "opens but doesn't rotate" — orbit-drag
   * never reaches model-viewer because Telegram's WebView claims the
   * vertical component of the gesture first). Optional on the real client
   * object — guard with `?.()` since an older Telegram client won't have
   * it.
   */
  disableVerticalSwipes?(): void;
  enableVerticalSwipes?(): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ?? null;
}
