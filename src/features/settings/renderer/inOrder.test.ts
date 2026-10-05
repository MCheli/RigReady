import { describe, expect, it } from 'vitest';
import { InOrder } from './inOrder';

/** A change that is answered when the test says so. */
function slow<T>(log: string[], name: string, answer: T) {
  let finish!: () => void;
  const answered = new Promise<void>((resolve) => (finish = resolve));
  return {
    change: async (): Promise<T> => {
      log.push(`${name} sent`);
      await answered;
      log.push(`${name} answered`);
      return answer;
    },
    finish,
  };
}

describe('changes made with a switch', () => {
  it('are sent one at a time in the order they were made, however long each takes', async () => {
    const log: string[] = [];
    const queue = new InOrder();
    const on = slow(log, 'on', 'on');
    const off = slow(log, 'off', 'off');
    const first = queue.send(on.change);
    const second = queue.send(off.change);
    expect(queue.busy).toBe(true);
    // The second is not sent while the first is under way, even when it would be quicker.
    off.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toEqual(['on sent']);
    on.finish();
    expect(await first).toEqual({ result: 'on', last: false });
    expect(await second).toEqual({ result: 'off', last: true });
    expect(log).toEqual(['on sent', 'on answered', 'off sent', 'off answered']);
    expect(queue.busy).toBe(false);
  });

  it('a change made alone is the last one, and so is one made after the others were answered', async () => {
    const queue = new InOrder();
    expect(await queue.send(async () => 1)).toEqual({ result: 1, last: true });
    expect(await queue.send(async () => 2)).toEqual({ result: 2, last: true });
  });

  it('a change that throws is told to whoever made it, and the next one is still sent', async () => {
    const queue = new InOrder();
    const failed = queue.send(async () => {
      throw new Error('the window is closing');
    });
    const next = queue.send(async () => 'next');
    await expect(failed).rejects.toThrow('the window is closing');
    expect(await next).toEqual({ result: 'next', last: true });
    expect(queue.busy).toBe(false);
  });
});
