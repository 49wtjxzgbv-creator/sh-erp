'use client';

import { useTranslations } from 'next-intl';
import { GraduationCap, PlayCircle, RotateCcw, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { useTraining } from '@/components/domain/training/training-provider';
import { TrainingOverallProgress, TrainingCourseStatus } from '@/components/domain/training/training-progress-bar';
import { useTrainingCleanup } from '@/components/domain/training/training-sandbox';

export default function TrainingCenterPage() {
  const t = useTranslations('training');
  const { courses, startCourse, courseProgress } = useTraining();
  const { hasSandboxData, cleanup, isCleaning } = useTrainingCleanup();

  const fullCycle = courses.find((c) => c.id === 'full-cycle');
  const individualCourses = courses.filter((c) => c.id !== 'full-cycle');

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <TrainingOverallProgress />

      {fullCycle && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader>
            <div className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">{fullCycle.title}</CardTitle>
            </div>
            <CardDescription>{fullCycle.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <TrainingCourseStatus courseId={fullCycle.id} />
            <div className="flex gap-2">
              {courseProgress(fullCycle.id).done > 0 && (
                <Button variant="outline" size="sm" onClick={() => startCourse(fullCycle.id, courseProgress(fullCycle.id).done)}>
                  {t('continueCourse')}
                </Button>
              )}
              <Button size="sm" onClick={() => startCourse(fullCycle.id, 0)}>
                <PlayCircle className="mr-2 h-4 w-4" />
                {t('startFullCycle')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">{t('reviewLessons')}</h2>
        <div className="divide-y divide-border rounded-lg border border-border">
          {individualCourses.map((course) => {
            const progress = courseProgress(course.id);
            const started = progress.done > 0;
            return (
              <div key={course.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{course.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{course.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <TrainingCourseStatus courseId={course.id} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => startCourse(course.id, started ? progress.done : 0)}
                  >
                    {started ? t('continueCourse') : t('startCourse')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {hasSandboxData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('cleanupButton')}</CardTitle>
            <CardDescription>{t('cleanupConfirmDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t('cleanupButton')}
                </Button>
              </DialogTrigger>
              <DialogContent size="sm">
                <DialogHeader>
                  <DialogTitle>{t('cleanupConfirmTitle')}</DialogTitle>
                  <DialogDescription>{t('cleanupConfirmDescription')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Скасувати
                    </Button>
                  </DialogClose>
                  <Button variant="destructive" loading={isCleaning} onClick={cleanup}>
                    {t('cleanupButton')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
