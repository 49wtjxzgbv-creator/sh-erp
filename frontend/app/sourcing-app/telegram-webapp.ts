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

/** Bot API 8.0+ — insets in CSS px, only non-zero while the Mini App is actually running. */
export interface TelegramSafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * 2026-11-25: only request true fullscreen on tablet/desktop-sized screens.
 * On a phone, `expand()` alone already fills the screen; `requestFullscreen()`
 * moves Telegram into a floating-chrome mode whose self-reported
 * `contentSafeAreaInset` proved unreliable on a real device (close/menu
 * buttons visibly overlapped our header while the reported inset stayed 0)
 * — a regression that didn't exist before fullscreen was requested. Only
 * iPad/desktop actually need the escape from the small "sheet" window that
 * motivated this in the first place, so only they take on that risk, with a
 * guaranteed-minimum fallback inset (see use-telegram-safe-area.ts) as a
 * safety net against the same under-reporting happening there too.
 */
export const TELEGRAM_FULLSCREEN_MIN_WIDTH = 768;

/**
 * 2026-11-25, second attempt: `window.innerWidth` measures the CURRENT
 * WebView viewport — which on iPad is exactly the small phone-sized sheet
 * this whole fix exists to escape, so gating on it never actually fired
 * (real user report: "на айпаді так і маленьке" — still small after the
 * width-gated fix shipped). `window.screen.width` is the real device
 * screen size regardless of how small the WebView is currently rendered,
 * so it correctly identifies a tablet/desktop even before expanding.
 */
export function isLargeScreenDevice(): boolean {
  return typeof window !== 'undefined' && window.screen.width >= TELEGRAM_FULLSCREEN_MIN_WIDTH;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string } };
  themeParams: TelegramThemeParams;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  close(): void;
  /** Device-level safe area (notch, home indicator) — `env(safe-area-inset-*)` already covers this via CSS, kept here only for completeness. */
  safeAreaInset?: TelegramSafeAreaInset;
  /** Bot API 8.0+ — space Telegram's own floating fullscreen chrome (close/more buttons) occupies over the content. See TELEGRAM_FULLSCREEN_MIN_WIDTH's doc comment for why this can't be trusted alone. */
  contentSafeAreaInset?: TelegramSafeAreaInset;
  requestFullscreen?(): void;
  onEvent(event: 'themeChanged' | 'contentSafeAreaChanged', callback: () => void): void;
  offEvent(event: 'themeChanged' | 'contentSafeAreaChanged', callback: () => void): void;
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
