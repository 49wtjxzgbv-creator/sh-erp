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
import { cn } from '@/lib/utils';
import { useSpeechRecognition, useSpeechSynthesis, speechLangForLocale } from '@/lib/hooks/use-speech';
import type { Locale } from '@/i18n';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  text: string;
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
      <div className="flex items-center justify-between">
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
              'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
              m.role === 'user' && 'ml-auto bg-primary text-primary-foreground',
              m.role === 'assistant' && 'bg-card border border-border',
              m.role === 'system' && 'mx-auto bg-secondary text-secondary-foreground text-xs italic',
            )}
          >
            {m.text}
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
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={handleFileChange}
                  className="text-xs text-muted-foreground file:mr-2 file:rounded-md file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs"
                />
                {file && <span className="text-xs text-muted-foreground">{file.name}</span>}
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
              </div>
              <Button type="submit" loading={askFullAssistant.isPending} disabled={!question.trim()}>
                {t('ask')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
