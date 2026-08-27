import { pdfRenderQueue } from './pdf-render-queue';

describe('pdfRenderQueue', () => {
  it('runs queued tasks one at a time, in order, never overlapping', async () => {
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];

    const task = (id: number, ms: number) =>
      pdfRenderQueue.run(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, ms));
        order.push(id);
        active--;
        return id;
      });

    const results = await Promise.all([task(1, 15), task(2, 5), task(3, 10)]);

    expect(maxActive).toBe(1);
    expect(order).toEqual([1, 2, 3]); // queued order preserved, not completion order
    expect(results).toEqual([1, 2, 3]);
  });

  it('a failed task does not wedge the queue — later tasks still run', async () => {
    await expect(pdfRenderQueue.run(() => Promise.reject(new Error('render failed')))).rejects.toThrow('render failed');
    const result = await pdfRenderQueue.run(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });
});
