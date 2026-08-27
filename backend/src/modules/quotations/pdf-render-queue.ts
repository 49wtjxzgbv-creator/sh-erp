/**
 * §7/§19 of the final confirmation: "Через VPS з 1 CPU Chromium запускати
 * строго через global queue/mutex — максимум один PDF render одночасно."
 * This is the first single-flight/mutex primitive in this codebase (no
 * Redis/BullMQ exists — see legacy-import.service.ts's own ADR-0005
 * disclaimer) — deliberately a plain in-process FIFO queue, not a new
 * infra dependency, since a 1-CPU box can't usefully run two Chromium
 * renders in parallel anyway; queuing them is strictly better than
 * fighting over the same core.
 *
 * A module-level singleton (not a NestJS-DI-scoped instance) so it's
 * shared across every possible instantiation path without relying on
 * Nest's own singleton-provider guarantee holding across, e.g., future
 * test setups that construct the service directly — matches how
 * `r2-client.ts`'s `R2_BUCKET` constant is a plain module export rather
 * than something threaded through DI.
 */
class PdfRenderQueue {
  private tail: Promise<unknown> = Promise.resolve();

  /** Runs `fn` once every render queued before it has finished (success or failure) — one Chromium process alive at a time, ever. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    // Swallow the result/rejection for queue-chaining purposes only — the
    // real result/error still propagates to this call's own caller via
    // `run` itself, below. Without this, one failed render would
    // permanently poison `tail` and wedge every render queued after it.
    this.tail = run.catch(() => undefined);
    return run;
  }
}

export const pdfRenderQueue = new PdfRenderQueue();
