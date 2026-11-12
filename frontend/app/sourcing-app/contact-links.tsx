'use client';

import { useState } from 'react';
import { getTelegramWebApp } from './telegram-webapp';

/** Tappable contact details (2026-11-10) — a real mobile-native touch the chat bot's plain text never had: tel:/mailto: open the phone/email app directly, and a website opens via Telegram's own `openLink` (keeps the user inside the Telegram app shell instead of a context switch). */
export function ContactLinks({ phone, email, website }: { phone: string | null; email: string | null; website: string | null }) {
  // "зроби можливість копіювати з картки можливого постачальника номер та
  // електронну адресу" (2026-11-12) — a tel:/mailto: tap OPENS the phone/
  // mail app, which isn't what you want when you just need the value on
  // the clipboard (e.g. to paste into a WhatsApp chat). One `copied`
  // field at a time is plenty — copying a second value before the first
  // badge clears is the normal case, not a bug to prevent.
  const [copiedField, setCopiedField] = useState<'phone' | 'email' | null>(null);

  if (!phone && !email && !website) return null;

  async function copy(field: 'phone' | 'email', value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      getTelegramWebApp()?.HapticFeedback.notificationOccurred('success');
      setTimeout(() => setCopiedField((f) => (f === field ? null : f)), 2000);
    } catch {
      getTelegramWebApp()?.HapticFeedback.notificationOccurred('error');
      getTelegramWebApp()?.showAlert('Не вдалося скопіювати.');
    }
  }

  function openWebsite(e: React.MouseEvent, url: string) {
    e.preventDefault();
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const webApp = getTelegramWebApp();
    if (webApp) webApp.openLink(normalized);
    else window.open(normalized, '_blank');
  }

  return (
    <div className="flex flex-col gap-1.5 text-sm">
      {phone && (
        <div className="flex items-center gap-1.5">
          <a href={`tel:${phone}`} className="flex items-center gap-1.5" style={{ color: 'var(--tg-link)' }}>
            📞 {phone}
          </a>
          <button type="button" onClick={() => copy('phone', phone)} className="px-1 text-xs active:opacity-60" style={{ color: 'var(--tg-hint)' }} aria-label="Копіювати номер">
            {copiedField === 'phone' ? '✅' : '📋'}
          </button>
        </div>
      )}
      {email && (
        <div className="flex items-center gap-1.5">
          <a href={`mailto:${email}`} className="flex items-center gap-1.5" style={{ color: 'var(--tg-link)' }}>
            ✉️ {email}
          </a>
          <button type="button" onClick={() => copy('email', email)} className="px-1 text-xs active:opacity-60" style={{ color: 'var(--tg-hint)' }} aria-label="Копіювати email">
            {copiedField === 'email' ? '✅' : '📋'}
          </button>
        </div>
      )}
      {website && (
        <a href={website} onClick={(e) => openWebsite(e, website)} className="flex items-center gap-1.5" style={{ color: 'var(--tg-link)' }}>
          🌐 {website}
        </a>
      )}
    </div>
  );
}
