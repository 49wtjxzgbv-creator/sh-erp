'use client';

import { getTelegramWebApp } from './telegram-webapp';

/** Tappable contact details (2026-11-10) — a real mobile-native touch the chat bot's plain text never had: tel:/mailto: open the phone/email app directly, and a website opens via Telegram's own `openLink` (keeps the user inside the Telegram app shell instead of a context switch). */
export function ContactLinks({ phone, email, website }: { phone: string | null; email: string | null; website: string | null }) {
  if (!phone && !email && !website) return null;

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
        <a href={`tel:${phone}`} className="flex items-center gap-1.5" style={{ color: 'var(--tg-link)' }}>
          📞 {phone}
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className="flex items-center gap-1.5" style={{ color: 'var(--tg-link)' }}>
          ✉️ {email}
        </a>
      )}
      {website && (
        <a href={website} onClick={(e) => openWebsite(e, website)} className="flex items-center gap-1.5" style={{ color: 'var(--tg-link)' }}>
          🌐 {website}
        </a>
      )}
    </div>
  );
}
