import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A guide read the test answers by hand, so it can be answered after a progress write. */
const calls = vi.hoisted(() => ({
  guideReads: [] as Array<(value: unknown) => void>,
  progress: {
    done: [] as string[],
    skipped: [] as string[],
    current: undefined as string | undefined,
  },
}));

vi.mock('../../../renderer/machine', () => ({ notifyMachineChanged: vi.fn() }));
vi.mock('../../../renderer/ipc', () => ({
  errorText: (e: { message?: string }) => e?.message ?? 'error',
  useClient: () => ({
    on: () => () => undefined,
    games: async () => ({
      ok: true,
      value: { games: [{ id: 'dcs', name: 'DCS World', available: true }] },
    }),
    aircraft: async () => ({ ok: true, value: { aircraft: [{ id: 'fa18', name: 'F/A-18C' }] } }),
    status: async () => ({ ok: true, value: { ready: false } }),
    guide: () =>
      new Promise((resolve) => {
        // What main holds at the moment it is asked.
        const snapshot = {
          done: [...calls.progress.done],
          skipped: [...calls.progress.skipped],
        };
        calls.guideReads.push(() =>
          resolve({
            ok: true,
            value: {
              tiers: [{ items: [{ id: 'cage' }, { id: 'trim' }] }],
              progress: snapshot,
            },
          })
        );
      }),
    setProgress: async (input: { itemId: string; state: string; current?: string }) => {
      if (input.state === 'done') calls.progress.done.push(input.itemId);
      calls.progress.current = input.current;
      return { ok: true, value: { ...calls.progress } };
    },
  }),
}));

import { useAiStore } from './store';

describe('the walkthrough progress', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    calls.guideReads = [];
    calls.progress = { done: [], skipped: [], current: undefined };
  });

  it('is not put back by a guide reload that was asked for before Done was pressed', async () => {
    const store = useAiStore();
    const first = store.load();
    await vi.waitFor(() => expect(calls.guideReads).toHaveLength(1));
    calls.guideReads.shift()!(undefined);
    await first;
    expect(store.guide?.progress.done).toEqual([]);

    // A file changed (an undo), so the page reloads; Done is pressed before it is answered.
    const reload = store.load();
    await vi.waitFor(() => expect(calls.guideReads).toHaveLength(1));
    await store.finish('done');
    expect(store.guide?.progress.done).toEqual(['cage']);

    calls.guideReads.shift()!(undefined);
    await reload;
    expect(store.guide?.progress.done).toEqual(['cage']);
  });

  it('a reload with no progress written meanwhile takes what main says', async () => {
    const store = useAiStore();
    calls.progress.done = ['trim'];
    const first = store.load();
    await vi.waitFor(() => expect(calls.guideReads).toHaveLength(1));
    calls.guideReads.shift()!(undefined);
    await first;
    expect(store.guide?.progress.done).toEqual(['trim']);
  });
});
