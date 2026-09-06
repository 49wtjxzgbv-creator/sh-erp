'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { useAskFullAssistant, useConfirmAiAction, useCancelAiAction } from '@/lib/hooks/use-ai';
import type { PendingConfirmation } from '@/lib/api-client/ai';
import { PendingConfirmationCard } from '@/components/domain/ai/pending-confirmation-card';
import { useApiErrorMessage } from '@/lib/api-error-message';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useSpeechRecognition, useSpeechSynthesis, speechLangForLocale } from '@/lib/hooks/use-speech';
import type { Locale } from '@/i18n';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
}

const URL_RE = /https?:\/\/[^\s<>()"']+/g;

/**
 * The assistant's own system prompt tells it to "обов'язково згадай
 * посилання" whenever a tool (exportToExcel/exportToPdf) creates a file —
 * the link IS the file, there's no separate attachment mechanism. Plain
 * `{m.text}` rendering left that URL as inert text a user had to manually
 * select and copy (real user report, 2026-09-06: "він дає якесь посилання
 * а не файл") — this splits on bare URLs and renders them as real,
 * clickable/downloadable links instead, leaving everything else as plain
 * text exactly as before.
 */
function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  const urls = text.match(URL_RE) ?? [];
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < urls.length && (
            <a href={urls[i]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
              {urls[i]}
            </a>
          )}
        </span>
      ))}
    </>
  );
}

/**
 * The full function-calling assistant (`askFullAssistant`). The opaque
 * `historyJson` string from each response is stored and echoed back
 * verbatim on the next call — it is NOT reconstructed from the locally
 * rendered `messages` array, since the real conversation state (including
 * tool-call/tool-response turns never shown in the UI) only exists inside
 * that string (confirmed from ai.service.ts: `contents` accumulates
 * function-call/function-response parts the UI never renders).
 */
export default function AiFullAssistantPage() {
  const t = useTranslations('ai');
  const tc = useTranslations('common');
  const apiErrorMessage = useApiErrorMessage();
  const askFullAssistant = useAskFullAssistant();
  const confirmAction = useConfirmAiAction();
  const cancelAction = useCancelAiAction();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyJson, setHistoryJson] = useState<string | undefined>(undefined);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<PendingConfirmation | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ base64: string; mimeType: string; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Voice mode — feature-detected Web Speech API wrappers (see lib/hooks/use-speech.ts).
  // Purely an input/output layer around the existing text-in/text-out askFullAssistant
  // contract: mic fills the textarea, TTS reads result.answer aloud. Neither is on by
  // default, and both degrade silently (button hidden) when the browser lacks support.
  const locale = useLocale() as Locale;
  const speechLang = speechLangForLocale(locale);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceReplyEnabled, setVoiceReplyEnabled] = useState(false);
  const questionBeforeListeningRef = useRef('');
  const speech = useSpeechRecognition({
    lang: speechLang,
    onResult: (transcript) => {
      const base = questionBeforeListeningRef.current;
      setQuestion(base ? `${base} ${transcript}` : transcript);
    },
    onError: () => setVoiceError(t('voiceRecognitionError')),
  });
  const synth = useSpeechSynthesis({ lang: speechLang });
  // Shows every voice installed in the browser, not just ones matching the
  // interface language (2026-09-07 fix — filtering to just "uk" left a
  // real user with exactly one option, "Леся", even though their system
  // had other voices too; a "wrong" language reading Ukrainian text still
  // beats no choice at all). Each option's own `lang` is shown alongside
  // its name so it's clear which are native to the current language.
  const voiceOptions = synth.voices;

  function toggleListening() {
    setVoiceError(null);
    if (speech.listening) {
      speech.stop();
      return;
    }
    questionBeforeListeningRef.current = question;
    speech.start();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      setFile({ base64, mimeType: f.type, name: f.name });
    };
    reader.readAsDataURL(f);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setError(null);
    const userText = question.trim();
    setMessages((prev) => [...prev, { role: 'user', text: userText + (file ? ` [${file.name}]` : '') }]);
    setQuestion('');
    const attachedFile = file;
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';

    try {
      const result = await askFullAssistant.mutateAsync({
        question: userText,
        historyJson,
        fileBase64: attachedFile?.base64,
        fileMimeType: attachedFile?.mimeType,
      });
      setHistoryJson(result.history);
      setMessages((prev) => [...prev, { role: 'assistant', text: result.answer }]);
      setPending(result.pendingConfirmation);
      if (voiceReplyEnabled) synth.speak(result.answer);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleConfirm() {
    if (!pending) return;
    setError(null);
    try {
      const result = await confirmAction.mutateAsync(pending.pendingActionId);
      setMessages((prev) => [...prev, { role: 'system', text: result.message ?? t('actionConfirmed') }]);
      setPending(undefined);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  async function handleCancel() {
    if (!pending) return;
    setError(null);
    try {
      await cancelAction.mutateAsync(pending.pendingActionId);
      setMessages((prev) => [...prev, { role: 'system', text: t('actionCancelled') }]);
      setPending(undefined);
    } catch (err) {
      setError(apiErrorMessage(err, tc('error')));
    }
  }

  function handleReset() {
    setMessages([]);
    setHistoryJson(undefined);
    setPending(undefined);
    setError(null);
    setVoiceError(null);
    if (speech.listening) speech.stop();
    synth.cancel();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t('fullAssistantDescription')}</p>
        {messages.length > 0 && (
          <Button size="sm" variant="ghost" onClick={handleReset}>
            {t('newConversation')}
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              'max-w-[85%] break-words rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
              m.role === 'user' && 'ml-auto bg-primary text-primary-foreground',
              m.role === 'assistant' && 'bg-card border border-border',
              m.role === 'system' && 'mx-auto bg-secondary text-secondary-foreground text-xs italic',
            )}
          >
            <LinkifiedText text={m.text} />
          </div>
        ))}
      </div>

      {pending && (
        <PendingConfirmationCard
          pending={pending}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          confirming={confirmAction.isPending}
          cancelling={cancelAction.isPending}
        />
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="space-y-3 pt-4">
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="relative">
              <Textarea
                placeholder={t('questionPlaceholder')}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={4000}
                rows={3}
                className={speech.supported ? 'pr-10' : undefined}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e as unknown as React.FormEvent);
                  }
                }}
              />
              {speech.supported && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className={cn('absolute right-1 top-1 h-8 w-8', speech.listening && 'text-destructive')}
                  onClick={toggleListening}
                  title={speech.listening ? t('micStop') : t('micStart')}
                  aria-label={speech.listening ? t('micStop') : t('micStart')}
                >
                  {speech.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>
              )}
            </div>
            {voiceError && <p className="text-xs text-destructive">{voiceError}</p>}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileChange}
                  className="max-w-[160px] text-xs text-muted-foreground file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs sm:max-w-none"
                />
                {file && <span className="max-w-[140px] truncate text-xs text-muted-foreground">{file.name}</span>}
                {synth.supported && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => {
                      const next = !voiceReplyEnabled;
                      setVoiceReplyEnabled(next);
                      if (!next) synth.cancel();
                    }}
                    title={voiceReplyEnabled ? t('voiceReplyOn') : t('voiceReplyOff')}
                    aria-label={voiceReplyEnabled ? t('voiceReplyOn') : t('voiceReplyOff')}
                  >
                    {voiceReplyEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                  </Button>
                )}
                {synth.supported && voiceReplyEnabled && voiceOptions.length > 0 && (
                  <Select value={synth.voiceURI ?? undefined} onValueChange={synth.selectVoice}>
                    <SelectTrigger className="h-8 w-32 text-xs sm:w-40">
                      <SelectValue placeholder={t('voiceSelectPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {voiceOptions.map((v) => (
                        <SelectItem key={v.voiceURI} value={v.voiceURI}>
                          {v.name} ({v.lang})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <Button type="submit" className="w-full sm:w-auto" loading={askFullAssistant.isPending} disabled={!question.trim()}>
                {t('ask')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
