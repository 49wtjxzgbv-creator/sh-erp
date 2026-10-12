'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

/**
 * "можемо додати такий самий переглядач і конвертер?
 * https://www.innerscene.com/tools/edrawings-viewer" (2026-10-12):
 * eDrawings (.easm/.eprt/.edrw) is SolidWorks' own closed, undocumented
 * binary format — building a parser/converter for it in-house isn't
 * realistic (and Innerscene's OWN conversion is already the exact source
 * of the generic-node-name problem `isWatertight`/the manual rename
 * feature on step-3d-viewer.tsx exist to work around — it never preserves
 * real article names, so this doesn't replace that workflow, only saves a
 * tab switch). Embeds their free, client-side tool (their own site: "files
 * are parsed locally in your browser... uploading only required if you
 * choose to share a link") directly in a dialog. The user still exports/
 * downloads the .glb from INSIDE this iframe themselves and attaches it
 * via the normal "Додати документ" button next to this one — Innerscene's
 * own embed docs only cover iframing the tool itself, no postMessage/
 * upload callback exists to capture the converted file automatically.
 *
 * Deliberately NOT their documented `?embedded=1` embed mode — confirmed
 * live (both iframed here AND loaded directly in its own tab) that mode
 * never leaves its own "Loading…" placeholder when no `url=` param points
 * it at an already-hosted file, which this flow doesn't have (the user is
 * converting a LOCAL file they haven't uploaded anywhere yet). The plain
 * page reaches a real "IDLE" state with a working "Drop a file here or
 * click to open" zone — the only tradeoff is their own page header/
 * toolbar chrome showing inside the dialog too.
 */
export function EdrawingsConverterButton({ className }: { className?: string }) {
  const t = useTranslations('files');
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="sm" className={className} onClick={() => setOpen(true)}>
        <Wand2 className="mr-2 h-4 w-4" />
        {t('convertEdrawings')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[85vh] w-[95vw] max-w-4xl flex-col">
          <DialogHeader>
            <DialogTitle>{t('convertEdrawings')}</DialogTitle>
            <DialogDescription>{t('convertEdrawingsHint')}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
            {open && (
              <iframe
                src="https://www.innerscene.com/tools/edrawings-viewer"
                className="h-full w-full"
                title="eDrawings Viewer — Innerscene"
                allow="fullscreen"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
