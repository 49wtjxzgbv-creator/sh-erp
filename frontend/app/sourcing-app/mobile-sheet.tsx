'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

/**
 * A bottom-sheet variant of the ERP's own `Dialog` (components/ui/dialog.tsx)
 * — that one is a centered modal, which doesn't read as "native" inside a
 * Telegram Mini App (research before building this: sheet-style modals that
 * slide up from the bottom are the expected pattern there). Built directly
 * on the same Radix primitive rather than wrapping the ERP's `Dialog`, since
 * the positioning/animation is fundamentally different, not just a style
 * override.
 */
export function MobileSheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 transition-opacity data-[state=closed]:opacity-0 data-[state=open]:opacity-100" />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-2xl pb-[env(safe-area-inset-bottom)] shadow-2xl transition-transform duration-200 data-[state=closed]:translate-y-full data-[state=open]:translate-y-0"
          style={{ background: 'var(--tg-section-bg)', color: 'var(--tg-text)' }}
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full" style={{ background: 'var(--tg-hint)', opacity: 0.4 }} />
          <div className="flex shrink-0 items-center justify-between px-4 pb-2 pt-3">
            <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="rounded-full p-1 opacity-70 hover:opacity-100">
              <X className="h-5 w-5" />
              <span className="sr-only">Закрити</span>
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
