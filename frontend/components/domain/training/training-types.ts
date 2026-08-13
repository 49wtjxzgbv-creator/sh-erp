/**
 * Course/step content is intentionally plain Ukrainian strings here, not
 * routed through next-intl like the rest of the app's UI chrome — this is
 * narrative teaching copy (16 courses' worth), and the spec this was built
 * against was itself Ukrainian-only. The surrounding UI controls (Далі/
 * Назад/Пропустити button labels, Training Center headings) DO go through
 * next-intl as usual — see messages/*.json's `training` namespace.
 */

export type TrainingStepMode = 'demo' | 'practice';

export interface TrainingStepCheckpoint {
  /** Step is considered done once the app navigates to a route starting with this prefix — a real signal, since every create-form in this app only navigates on a successful API call. */
  type: 'route';
  route: string;
}

export interface TrainingStep {
  id: string;
  title: string;
  /** "Що ми зараз робимо." */
  what: string;
  /** "Навіщо це потрібно." */
  why: string;
  /** Real app route this step lives on. */
  route: string;
  /** Matches a `data-tour="…"` attribute on the real element to spotlight. Omit for a step with no single element to point at (e.g. an overview step). */
  targetSelector?: string;
  mode: TrainingStepMode;
  /** Practice-only: the literal instruction shown, e.g. "Введіть назву «[Навчання] Тестовий виріб» і натисніть Зберегти." */
  instruction?: string;
  /** Practice-only: how completion is detected. Absent = user confirms manually via "Готово, далі". Deliberately coarse — no per-field validation, per product decision. */
  checkpoint?: TrainingStepCheckpoint;
  /**
   * Practice-only: marks that this step, once its checkpoint fires, created
   * a real entity worth tracking for cleanup — see training-sandbox.ts.
   * Limited to types that actually have a real undo action in the backend
   * today (`DELETE products/:id`, `POST customer-orders/:id/cancel`) — e.g.
   * PurchaseOrder has neither a delete nor a cancel endpoint, so a practice
   * step that creates one is real, useful practice, but is deliberately NOT
   * tagged here: claiming "Очистити навчальні дані" removes it would be
   * lying about what the backend can actually do.
   */
  sandboxEntity?: 'product' | 'assembly' | 'customerOrder';
}

export interface TrainingCourse {
  id: string;
  title: string;
  description: string;
  steps: TrainingStep[];
}
