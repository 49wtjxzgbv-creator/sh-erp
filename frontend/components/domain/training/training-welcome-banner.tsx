'use client';

import { useTranslations } from 'next-intl';
import { GraduationCap } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useTraining } from './training-provider';

/**
 * Shown once, on first authenticated visit (per-browser, via the same
 * localStorage pattern as theme/sidebar) — "Ласкаво просимо" per spec.
 * Dismissing (either button) marks it seen for good; "Навчання" stays
 * reachable from the sidebar regardless.
 */
export function TrainingWelcomeBanner() {
  const t = useTranslations('training');
  const { hasSeenWelcome, dismissWelcome, startCourse } = useTraining();

  return (
    <Dialog open={!hasSeenWelcome} onOpenChange={(open) => { if (!open) dismissWelcome(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <GraduationCap className="h-5 w-5" />
          </div>
          <DialogTitle>{t('welcomeTitle')}</DialogTitle>
          <DialogDescription>{t('welcomeBody')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={dismissWelcome}>
            {t('skipTraining')}
          </Button>
          <Button
            onClick={() => {
              dismissWelcome();
              startCourse('full-cycle');
            }}
          >
            {t('startTraining')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
