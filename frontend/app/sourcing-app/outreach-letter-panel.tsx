'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DocumentPreview } from './document-preview';
import { getTelegramWebApp } from './telegram-webapp';
import { useGenerateOutreachLetter, useSendOutreachLetterEmail } from './use-sourcing-app';
import type { OutreachLetter } from './sourcing-app-client';

/**
 * "біля кожного нового постачальника додай кнопку сформувати листа ...
 * привітання і запит на співпрацю з проханням прорахувати деталі ... окрім
 * тексту має бути пдф файл з фото артикулом та назвою деталі ... після
 * формування має бути електронна пошта телеграм вотсап чи ще щось куди
 * саме надсилати" (2026-11-11) — admin-only panel inside `CandidateSheet`.
 * "Генерувати" calls the AI once and shows an EDITABLE draft (the admin
 * reviews/tweaks before anything goes out). The PDF is a real presigned
 * R2 URL ("неможливо скачати", 2026-11-11 — a client-only `blob:` URL
 * built from base64 wasn't downloadable inside Telegram's own WebView;
 * `SourcingAppService#generateOutreachLetter` now persists it as a real
 * `FileAsset`), opened externally via `openLink` for actual saving — the
 * same convention `ContactLinks`' own website link already uses — with an
 * in-app `DocumentPreview` as a quick-look secondary option. Channels are
 * whichever contact fields the candidate actually has — email sends for
 * real through the backend's SMTP; WhatsApp just opens a pre-filled
 * `wa.me` link (no API exists to attach a file to that deep link, so the
 * PDF has to be attached by hand there).
 */
export function OutreachLetterPanel({ candidateId }: { candidateId: string }) {
  const textFieldId = useId();
  const generate = useGenerateOutreachLetter();
  const sendEmail = useSendOutreachLetterEmail();

  const [letter, setLetter] = useState<OutreachLetter | null>(null);
  const [text, setText] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // Reset whenever the sheet is pointed at a different candidate — a
  // leftover draft from a PREVIOUS candidate must never bleed into this
  // one (same class of bug `ProductSheet`'s own reset-on-open already
  // documents for lightbox/3D state).
  useEffect(() => {
    setLetter(null);
    setText('');
    setPreviewOpen(false);
    setEmailSent(false);
  }, [candidateId]);

  async function handleGenerate() {
    try {
      const result = await generate.mutateAsync(candidateId);
      setLetter(result);
      setText(result.text);
      setEmailSent(false);
      getTelegramWebApp()?.HapticFeedback.notificationOccurred('success');
    } catch (err) {
      getTelegramWebApp()?.HapticFeedback.notificationOccurred('error');
      const message = err instanceof Error ? err.message : 'Не вдалося згенерувати лист. Спробуйте ще раз.';
      getTelegramWebApp()?.showAlert(message);
    }
  }

  async function handleSendEmail() {
    try {
      const result = await sendEmail.mutateAsync({ candidateId, text });
      // "sent: false" (2026-11-11) — EmailService fails OPEN when SMTP
      // isn't configured (logs instead of throwing, see its own header
      // comment), so a resolved promise does NOT by itself mean delivery
      // happened. Claiming "✅ Надіслано" here regardless would be the
      // exact same silent-failure shape already hit twice this session
      // with a missing env var on this SEPARATE sourcing-bot process.
      if (!result.sent) {
        getTelegramWebApp()?.HapticFeedback.notificationOccurred('warning');
        getTelegramWebApp()?.showAlert('SMTP не налаштовано на сервері — лист НЕ надіслано. Скопіюйте текст і PDF вручну.');
        return;
      }
      getTelegramWebApp()?.HapticFeedback.notificationOccurred('success');
      setEmailSent(true);
      setTimeout(() => setEmailSent(false), 3000);
    } catch (err) {
      getTelegramWebApp()?.HapticFeedback.notificationOccurred('error');
      const message = err instanceof Error ? err.message : 'Не вдалося надіслати лист. Спробуйте ще раз.';
      getTelegramWebApp()?.showAlert(message);
    }
  }

  function openWhatsapp() {
    if (!letter?.candidatePhone) return;
    const digits = letter.candidatePhone.replace(/\D/g, '');
    const url = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
    const webApp = getTelegramWebApp();
    if (webApp) webApp.openLink(url);
    else window.open(url, '_blank');
  }

  function openPdfExternally() {
    if (!letter) return;
    const webApp = getTelegramWebApp();
    if (webApp) webApp.openLink(letter.pdfUrl);
    else window.open(letter.pdfUrl, '_blank');
  }

  return (
    <section>
      <p className="mb-1.5 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Запит на прорахунок</p>

      {!letter ? (
        <Button variant="outline" className="w-full" onClick={handleGenerate} loading={generate.isPending}>
          ✉️ Сформувати лист
        </Button>
      ) : (
        <div className="space-y-2">
          <label htmlFor={textFieldId} className="sr-only">Текст листа</label>
          <textarea
            id={textFieldId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            className="w-full resize-none rounded-lg p-2.5 text-sm outline-none"
            style={{ background: 'var(--tg-secondary-bg)', color: 'var(--tg-text)' }}
          />

          <div className="flex gap-2">
            {/* "неможливо скачати" (2026-11-11) — the primary action opens the real presigned URL in the system browser, which can actually save/share a file; the in-app preview below is a quick-look option, not a replacement for this. */}
            <Button size="sm" className="flex-1" onClick={openPdfExternally}>
              ⬇️ PDF — {letter.productCount} товар{letter.productCount === 1 ? '' : letter.productCount < 5 ? 'и' : 'ів'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)}>
              👁
            </Button>
          </div>

          <Button variant="outline" size="sm" onClick={handleGenerate} loading={generate.isPending}>
            🔄 Згенерувати заново
          </Button>

          <p className="pt-1 text-xs font-semibold uppercase" style={{ color: 'var(--tg-hint)' }}>Надіслати</p>
          <div className="flex flex-wrap gap-2">
            {letter.candidateEmail && (
              <Button size="sm" onClick={handleSendEmail} loading={sendEmail.isPending}>
                {emailSent ? '✅ Надіслано' : `📧 ${letter.candidateEmail}`}
              </Button>
            )}
            {letter.candidatePhone && (
              <Button size="sm" variant="outline" onClick={openWhatsapp}>
                💬 WhatsApp
              </Button>
            )}
            {!letter.candidateEmail && !letter.candidatePhone && (
              <p className="text-xs" style={{ color: 'var(--tg-hint)' }}>У постачальника не вказано ні email, ні телефону — скопіюйте текст і PDF вручну.</p>
            )}
          </div>
        </div>
      )}

      {previewOpen && letter && (
        <DocumentPreview doc={{ id: candidateId, name: letter.pdfFilename, url: letter.pdfUrl }} onClose={() => setPreviewOpen(false)} />
      )}
    </section>
  );
}
