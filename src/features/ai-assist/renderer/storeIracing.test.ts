import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The guide page's store when answers come late (AI-IRACING-002, AI-IRACING-004): the game
 * chosen last wins, a read for what was shown before is not put on screen, a listen stopped
 * while the controllers start takes no key, a key is only for the item on screen, and a save
 * that ends after its dialog was closed leaves the screen alone. Each answer of the main side
 * is held back here and given when the test says.
 */

type Resolve = (value: unknown) => void;
const calls = vi.hoisted(() => ({
  /** Answers held back, by channel, in the order they were asked for. */
  held: {} as Record<string, Array<{ input: unknown; resolve: Resolve }>>,
  machineChanged: 0,
}));

vi.mock('../../../renderer/machine', () => ({
  notifyMachineChanged: () => {
    calls.machineChanged++;
  },
}));
vi.mock('../../../renderer/ipc', () => {
  const hold =
    (channel: string) =>
    (input?: unknown): Promise<unknown> =>
      new Promise((resolve) => {
        (calls.held[channel] ??= []).push({ input, resolve });
      });
  return {
    errorText: (e: { message?: string }) => e?.message ?? 'error',
    useClient: () => ({
      on: () => () => undefined,
      status: async () => ({ ok: true, value: { ready: false } }),
      setCurrent: async () => ({ ok: true, value: { done: [], skipped: [] } }),
      games: hold('games'),
      aircraft: hold('aircraft'),
      guide: hold('guide'),
      listenStart: hold('listenStart'),
      listenStop: hold('listenStop'),
      iracingBindPreview: hold('iracingBindPreview'),
      iracingBind: hold('iracingBind'),
    }),
  };
});

import { useAiStore } from './store';

const GAMES = {
  ok: true,
  value: {
    games: [
      { id: 'dcs', name: 'DCS World', available: true },
      { id: 'iracing', name: 'iRacing', available: true },
    ],
  },
};
const list = (game: string, id: string) => ({
  ok: true,
  value: { game, available: true, gameName: game, aircraft: [{ id, name: id, guide: 'shipped' }] },
});
const action = (actionId: string) => ({ actionId, label: actionId, dcsName: actionId, bound: [] });
const guideOf = (game: string, aircraftId: string) => ({
  ok: true,
  value: {
    game,
    aircraftId,
    aircraftName: aircraftId,
    tiers: [
      {
        tier: 'must',
        items: [
          { id: 'limiter', actions: [action('PitSpeedLimiter')] },
          { id: 'flash', actions: [action('HeadlightFlash')] },
        ],
      },
    ],
    progress: { done: [], skipped: [] },
    staged: [],
  },
});

/** Answers the oldest held call of a channel; waits until it has been asked for. */
async function answer(channel: string, value: unknown): Promise<unknown> {
  await vi.waitFor(() => expect(calls.held[channel]?.length ?? 0).toBeGreaterThan(0));
  const call = calls.held[channel]!.shift()!;
  call.resolve(value);
  // Let the store carry on with the answer.
  await new Promise((r) => setTimeout(r, 0));
  return call.input;
}
const asked = (channel: string): number => calls.held[channel]?.length ?? 0;

/** A key as the page's window would see it pressed. */
function press(key: string, code: string, shiftKey = false): void {
  const event = Object.assign(new Event('keydown'), {
    key,
    code,
    shiftKey,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
  });
  window.dispatchEvent(event);
}

/** The store showing the iRacing GT3 guide, everything answered. */
async function showingIracing() {
  const store = useAiStore();
  const loaded = store.load('iracing');
  await answer('games', GAMES);
  await answer('aircraft', list('iracing', 'iracing:gt3'));
  await answer('guide', guideOf('iracing', 'iracing:gt3'));
  await loaded;
  expect(store.guide?.aircraftId).toBe('iracing:gt3');
  return store;
}

beforeEach(() => {
  setActivePinia(createPinia());
  calls.held = {};
  calls.machineChanged = 0;
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the guide page when answers come late', () => {
  it('the game chosen last wins, even while the one before it is still being read', async () => {
    const store = await showingIracing();
    const toDcs = store.selectGame('dcs');
    const backToIracing = store.selectGame('iracing');
    // The answers come in the order they were asked for: DCS's first.
    await answer('games', GAMES);
    await answer('games', GAMES);
    expect(asked('aircraft')).toBe(1);
    expect(await answer('aircraft', list('iracing', 'iracing:gt4'))).toEqual({ game: 'iracing' });
    await answer('guide', guideOf('iracing', 'iracing:gt4'));
    await Promise.all([toDcs, backToIracing]);
    expect(store.game).toBe('iracing');
    expect(store.list?.game).toBe('iracing');
    expect(store.guide?.aircraftId).toBe('iracing:gt4');
  });

  it('a guide read for the game shown before is not put on screen after a switch', async () => {
    const store = await showingIracing();
    // A reload of the iRacing guide is on its way when DCS is chosen.
    const reload = store.loadGuide('iracing:gt3');
    const toDcs = store.selectGame('dcs');
    await answer('guide', guideOf('iracing', 'iracing:gt3'));
    await reload;
    expect(store.guide).toBeUndefined();
    await answer('games', GAMES);
    await answer('aircraft', list('dcs', 'FA-18C_hornet'));
    await answer('guide', guideOf('dcs', 'FA-18C_hornet'));
    await toDcs;
    expect(store.guide?.game).toBe('dcs');
  });

  it('a listen stopped while the controllers start takes no key, and main is told to stop again', async () => {
    const store = await showingIracing();
    const listening = store.listen('PitSpeedLimiter');
    expect(store.listeningFor).toBe('PitSpeedLimiter');
    // The page is left before the controllers have started.
    const stopped = store.stopListening();
    await answer('listenStop', { ok: true, value: { listening: false } });
    await stopped;
    await answer('listenStart', { ok: true, value: { listening: true } });
    await answer('listenStop', { ok: true, value: { listening: false } });
    await listening;
    press('J', 'KeyJ', true);
    expect(asked('iracingBindPreview')).toBe(0);
    expect(store.listeningFor).toBeUndefined();
  });

  it('a key is taken only for an action of the item on screen', async () => {
    const store = await showingIracing();
    const listening = store.listen('PitSpeedLimiter');
    await answer('listenStart', { ok: true, value: { listening: true } });
    await listening;
    // Another item is chosen: the listen ends, and the next key is nobody's.
    const moved = store.goTo('flash');
    await answer('listenStop', { ok: true, value: { listening: false } });
    await moved;
    press('J', 'KeyJ', true);
    expect(asked('iracingBindPreview')).toBe(0);

    // On the item on screen a key is shown first, as iRacing would store it.
    const again = store.listen('HeadlightFlash');
    await answer('listenStart', { ok: true, value: { listening: true } });
    await again;
    press('Shift', 'ShiftLeft', true);
    expect(asked('iracingBindPreview')).toBe(0);
    press('J', 'KeyJ', true);
    await answer('listenStop', { ok: true, value: { listening: false } });
    expect(await answer('iracingBindPreview', { ok: false, error: { message: 'x' } })).toEqual({
      aircraftId: 'iracing:gt3',
      actionId: 'HeadlightFlash',
      binding: {
        kind: 'keyPress',
        key: 'J',
        code: 'KeyJ',
        shiftKey: true,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
      },
    });
  });

  it('a save that ends after its dialog was closed leaves the screen alone, and still tells the other pages', async () => {
    const store = await showingIracing();
    store.iracingBinding = {
      actionId: 'HeadlightFlash',
      binding: { kind: 'button', device: 'X', button: 4 },
      review: {
        actionId: 'HeadlightFlash',
        label: 'Flash headlights',
        forCars: 'All cars',
        before: 'Not bound',
        after: 'Button 4',
        same: false,
        conflicts: [],
        preview: { summary: '', files: [] },
        seen: 'a'.repeat(64),
      },
      busy: false,
    };
    const review = store.iracingBinding;
    const saving = store.saveIracing();
    store.cancelIracing();
    await answer('iracingBind', { ok: true, value: { changed: true, message: 'Saved.' } });
    await saving;
    expect(store.iracingSaved).toBeUndefined();
    expect(store.iracingBinding).toBeUndefined();
    expect(asked('guide')).toBe(0);
    expect(calls.machineChanged).toBe(1);

    // With the dialog still open, the save is said and the guide read again.
    store.iracingBinding = review;
    const shown = store.saveIracing();
    await answer('iracingBind', { ok: true, value: { changed: true, message: 'Saved again.' } });
    await answer('guide', guideOf('iracing', 'iracing:gt3'));
    await shown;
    expect(store.iracingSaved).toBe('Saved again.');
    expect(store.iracingBinding).toBeUndefined();
    expect(calls.machineChanged).toBe(2);
  });
});
