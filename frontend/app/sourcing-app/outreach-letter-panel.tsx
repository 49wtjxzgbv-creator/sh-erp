'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DocumentPreview } from './document-preview';
import { getTelegramWebApp } from './telegram-webapp';
import { useGenerateOutreachLetter, useSendOutreachLetterEmail } from './use-sourcing-app';
import type { OutreachLetter } from './sourcing-app-client';

function base64ToBlobUrl(base64: string, mime: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/**
 * "біля кожного нового постачальника додай кнопку сформувати листа ...
 * привітання і запит на співпрацю з проханням прорахувати деталі ... окрім
 * тексту має бути пдф файл з фото артикулом та назвою деталі ... після
 * формування має бути електронна пошта телеграм вотсап чи ще щось куди
 * саме надсилати" (2026-11-11) — admin-only panel inside `CandidateSheet`.
 * "Генерувати" calls the AI once and shows an EDITABLE draft (the admin
 * reviews/tweaks before anything goes out); the PDF (photo/article/name of
 * every product in the candidate's own category) opens in the same
 * `DocumentPreview` product documents already use. Channels are whichever
 * contact fields the candidate actually has — email sends for real
 * through the backend's SMTP; WhatsApp just opens a pre-filled `wa.me`
 * link (no API exists to attach a file to that deep link, so the PDF has
 * to be attached by hand there — same practical limit `ContactLinks`
 * already accepts for phone/website).
 */
export function OutreachLetterPanel({ candidateId }: { candidateId: string }) {
  const textFieldId = useId();
  const generate = useGenerateOutreachLetter();
  const sendEmail = useSendOutreachLetterEmail();

  const [letter, setLetter] = useState<OutreachLetter | null>(null);
  const [text, setText] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
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
    setPdfUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [candidateId]);

  // Blob URLs are only reclaimed when explicitly revoked — release the
  // previous one before creating the next, and on unmount.
  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGenerate() {
    try {
      const result = await generate.mutateAsync(candidateId);
      setLetter(result);
      setText(result.text);
      setEmailSent(false);
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return base64ToBlobUrl(result.pdfBase64, 'application/pdf');
      });
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

          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg p-2.5 text-left text-sm active:opacity-70"
            style={{ background: 'var(--tg-secondary-bg)' }}
          >
            📕 <span>PDF — {letter.productCount} товар{letter.productCount === 1 ? '' : letter.productCount < 5 ? 'и' : 'ів'}</span>
          </button>

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

      {previewOpen && pdfUrl && (
        <DocumentPreview doc={{ id: candidateId, name: letter?.pdfFilename ?? 'rfq.pdf', url: pdfUrl }} onClose={() => setPreviewOpen(false)} />
      )}
    </section>
  );
}
