'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';

/**
 * Photo picker for entities that don't exist yet (create forms).
 * EntityPhotoField/FileUploadField upload straight to R2 against a real
 * entityId, which doesn't exist until the parent record is saved — this
 * just holds the chosen File locally with an object-URL preview. The
 * caller uploads it (via uploadFile) once the real id comes back from the
 * create call, then discards this.
 */
export interface PendingPhotoFieldProps {
  value: File | null;
  onChange: (file: File | null) => void;
  accept?: string;
}

export function PendingPhotoField({ value, onChange, accept = 'image/*' }: PendingPhotoFieldProps) {
  const tc = useTranslations('common');
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();

  useEffect(() => {
    if (!value) {
      setPreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onChange(file);
  }

  return (
    <div className="flex items-center gap-3">
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleFileSelected} />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="rounded-md ring-offset-background transition-opacity hover:opacity-80"
        aria-label={tc('edit')}
      >
        <Avatar src={previewUrl} size="2xl" />
      </button>
      <div className="flex flex-col gap-1">
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <Upload className="mr-2 h-4 w-4" />
          {value ? tc('edit') : tc('create')}
        </Button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-left text-xs text-muted-foreground hover:text-foreground"
          >
            {tc('delete')}
          </button>
        )}
      </div>
    </div>
  );
}
