'use client';

import { useTranslations } from 'next-intl';
import { Paperclip } from 'lucide-react';
import { useFilesForEntity } from '@/lib/hooks/use-files';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

export interface ItemFileAttachmentsPickerProps {
  /** Files are sourced from this line's linked Product's own PRODUCT_DOCUMENT attachments — null/undefined (no linked product, e.g. a manually-typed article) just renders nothing. */
  productId: string | undefined;
  value: string[];
  onChange: (fileIds: string[]) => void;
}

/**
 * "додай можливість додавати файли з товарів ... якщо там декілька файлів
 * додай можливість які саме додавати або додавати всі і це окремо до
 * кожної позиції" (2026-10-21) — per-line choice of which of the linked
 * product's own attached documents get merged as extra pages onto the
 * generated purchase-request PDF (PurchaseRequestPdfService). "Attach all"
 * is just toggling every checkbox, not a separate persisted state.
 */
export function ItemFileAttachmentsPicker({ productId, value, onChange }: ItemFileAttachmentsPickerProps) {
  const t = useTranslations('procurement');
  const { data: files } = useFilesForEntity('Product', productId, 'PRODUCT_DOCUMENT');

  if (!productId) return null;
  const list = files ?? [];
  if (list.length === 0) return null;

  const allSelected = list.length > 0 && list.every((f) => value.includes(f.id));

  function toggle(fileId: string) {
    onChange(value.includes(fileId) ? value.filter((id) => id !== fileId) : [...value, fileId]);
  }
  function toggleAll() {
    onChange(allSelected ? [] : list.map((f) => f.id));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Paperclip className="mr-1.5 h-3.5 w-3.5" />
          {t('attachFiles')}
          {value.length > 0 ? ` (${value.length})` : ''}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-2">
          <label className="flex items-center gap-2 border-b border-border pb-2 text-sm font-medium">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            {t('attachAllFiles')}
          </label>
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {list.map((f) => (
              <label key={f.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={value.includes(f.id)} onChange={() => toggle(f.id)} />
                <span className="truncate" title={f.originalName}>{f.originalName}</span>
              </label>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
