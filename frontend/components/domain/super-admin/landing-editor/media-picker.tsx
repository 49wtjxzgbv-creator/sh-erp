'use client';

import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, ImageIcon, Upload, X } from 'lucide-react';
import { readImageFromClipboard, readImageFromDrop } from '@/lib/clipboard-image';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { landingPageAdminApi, type LandingMediaAssetRow } from '@/lib/super-admin/landing-page-api';

/**
 * Picks/uploads a marketing image, storing just the LandingMediaAsset id on
 * the field it's bound to. Reuses the drag/drop/paste UX already
 * established in components/domain/files/pending-photo-field.tsx, against
 * the new landing-page media endpoints instead of the tenant FilesService
 * flow. Shows the existing media library alongside the upload button so an
 * image already uploaded for one field can be reused on another without
 * re-uploading.
 */
export function MediaPicker({ value, onChange, label }: { value: string | null; onChange: (mediaId: string | null) => void; label: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState<LandingMediaAssetRow[] | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      setPreviewUrl(null);
      return;
    }
    // The current value's own thumbnail — cheapest way to get its
    // downloadUrl is the same library list this component already fetches
    // lazily on open; until then just show the generic placeholder.
    setPreviewUrl((prev) => (library?.find((m) => m.id === value)?.downloadUrl ?? prev));
  }, [value, library]);

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const media = await landingPageAdminApi.uploadMedia(file);
      onChange(media.id);
      setPreviewUrl(media.downloadUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження');
    } finally {
      setUploading(false);
    }
  }

  async function openLibrary() {
    setLibraryOpen(true);
    if (!library) setLibrary(await landingPageAdminApi.listMedia());
  }

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) upload(file);
  }

  async function handlePaste() {
    setError(null);
    const file = await readImageFromClipboard();
    if (file) await upload(file);
    else setError('Не вдалося вставити зображення з буфера обміну.');
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = readImageFromDrop(e);
    if (file) upload(file);
  }

  return (
    <div className="space-y-1.5">
      <p className="text-sm text-slate-300">{label}</p>
      <div className="flex items-start gap-3">
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelected} />
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={cn(
            'flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-slate-700 bg-slate-800 text-slate-500',
            isDragOver && 'border-primary text-primary',
          )}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived presigned admin-preview URL, not a public/cacheable image (see files module's own Avatar precedent)
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon className="h-6 w-6" />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" variant="outline" size="sm" loading={uploading} onClick={() => inputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              Завантажити
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handlePaste}>
              <ClipboardPaste className="mr-2 h-4 w-4" />
              Вставити
            </Button>
            <Popover open={libraryOpen} onOpenChange={(o) => (o ? openLibrary() : setLibraryOpen(false))}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  Бібліотека
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                {!library ? (
                  <p className="text-xs text-muted-foreground">Завантаження…</p>
                ) : library.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Ще немає завантажених зображень.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {library.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onChange(m.id);
                          setPreviewUrl(m.downloadUrl);
                          setLibraryOpen(false);
                        }}
                        className={cn(
                          'aspect-video overflow-hidden rounded border',
                          m.id === value ? 'border-primary ring-2 ring-primary' : 'border-border',
                        )}
                        title={m.originalName}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived presigned admin-preview URL */}
                        <img src={m.downloadUrl} alt={m.originalName} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
            {value && (
              <Button type="button" variant="ghost" size="sm" onClick={() => { onChange(null); setPreviewUrl(null); }}>
                <X className="mr-1 h-4 w-4" />
                Прибрати
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Перетягніть файл сюди, вставте з буфера або виберіть з бібліотеки.</p>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </div>
  );
}
