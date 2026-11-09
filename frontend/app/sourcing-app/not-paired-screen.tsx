'use client';

/** Shown when TelegramWebAppAuthGuard returns SOURCING_BOT_NOT_PAIRED (2026-11-10) — pairing itself stays exactly as already shipped (self-service /notifications, or an admin-generated link from /admin), this screen just points there instead of showing a bare error. */
export function NotPairedScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-4xl">🔒</div>
      <p className="text-base font-semibold" style={{ color: 'var(--tg-text)' }}>
        Ваш акаунт ще не прив&apos;язано
      </p>
      <p className="text-sm" style={{ color: 'var(--tg-hint)' }}>
        Зверніться до адміністратора — він згенерує для вас посилання прив&apos;язки на сторінці «Сповіщення» або «Адмін → Користувачі» в ERP.
      </p>
    </div>
  );
}
