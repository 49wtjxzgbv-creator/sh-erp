'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';

/**
 * `window.confirm()` is a native, synchronous browser dialog — it blocks
 * the page's own event loop entirely, which is a jarring UX inconsistency
 * with the rest of this app's Dialog-based confirmations (see Catalog/BOM
 * delete) and, worse, freezes any automated browser control (CDP input
 * events cannot reach a native dialog at all) until a human manually
 * dismisses it. A plain in-app Dialog avoids both problems.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  confirmLabel,
  confirming,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  confirmLabel: string;
  confirming?: boolean;
}) {
  const tc = useTranslations('superAdmin');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-800 bg-slate-900 text-slate-100">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-slate-400">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {tc('cancel')}
            </Button>
          </DialogClose>
          <Button type="button" variant="destructive" loading={confirming} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
