import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { AircraftList, GuideGames, GuideView } from './model';
import { GAME_ROLES, gameOfKey, guideKey, packText, parsePack, TIERS } from './pack';
import { shippedPack } from './shipped';

/**
 * The binding guide for Nuclear Option: one guide for every aircraft, on the bindings the
 * game saved (fixtures/scenarios/nuclear-option-bindings.yaml). It shows what is bound and
 * what is not; nothing is bound from the guide, and no AI request is made for it.
 */
const GUIDE = 'nuclear-option:all';

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});
const start = async (scenario = 'nuclear-option-bindings'): Promise<WiredApp> =>
  (app = await wiredApp(scenario));
const guideOf = (a: WiredApp): Promise<GuideView> =>
  a.invoke<GuideView>('ai-assist:guide', { aircraftId: GUIDE });
const itemsOf = (view: GuideView) => view.tiers.flatMap((t) => t.items);

describe('the shipped guide for Nuclear Option', () => {
  const pack = shippedPack(GUIDE)!;

  it('is one guide for every aircraft, found by the game and "all"', () => {
    expect(pack).toBeDefined();
    expect(pack.game).toBe('nuclear-option');
    expect(pack.aircraft).toEqual({ id: 'all', name: 'All aircraft' });
    expect(guideKey('nuclear-option', 'all')).toBe(GUIDE);
    expect(gameOfKey(GUIDE)).toBe('nuclear-option');
    expect(gameOfKey('iracing:gt3')).toBe('iracing');
    expect(gameOfKey('FA-18C_hornet')).toBe('dcs');
    // Written back as a file it still says the game and "aircraft", and reads the same.
    const again = parsePack(packText(pack));
    expect(again.ok && again.value).toEqual(pack);
    expect(packText(pack)).toContain('game: nuclear-option');
    expect(packText(pack)).not.toContain('car:');
  });

  it('has every tier, a plan for the stick, the throttle and the pedals, explains each item and says who did not review it', () => {
    for (const tier of TIERS) {
      expect(pack.items.filter((i) => i.tier === tier).length, tier).toBeGreaterThan(2);
    }
    for (const role of ['stick', 'throttle', 'pedals', 'panel', 'keyboard'] as const) {
      expect(pack.roles[role]?.items.length, role).toBeGreaterThan(0);
    }
    // Every item is in the plan of the device it belongs on, and in no other.
    for (const item of pack.items) {
      const inPlans = GAME_ROLES['nuclear-option'].filter((role) =>
        pack.roles[role]?.items.includes(item.id)
      );
      expect(inPlans, item.id).toEqual([item.role]);
      expect(item.what.length, item.id).toBeGreaterThan(10);
      expect(item.when.length, item.id).toBeGreaterThan(5);
    }
    const sources = pack.sources.join(' ');
    expect(sources).toContain('Not reviewed');
    expect(sources).toContain('Not affiliated with or endorsed by Shockfront Studios');
  });

  it('refuses the racing places and roles, and `input`, in a Nuclear Option guide', () => {
    const text = packText(pack);
    const problems = (source: string): string => {
      const parsed = parsePack(source);
      return parsed.ok ? 'ok' : (parsed.error.detail ?? '');
    };
    expect(problems(text)).toBe('ok');
    expect(problems(text.replace('place: hotas', 'place: rim'))).toMatch(
      /place rim is not one of hotas, panel, keyboard/
    );
    expect(problems(text.replace('role: stick', 'role: wheel'))).toMatch(
      /role wheel is not one of stick, throttle, pedals, panel, keyboard/
    );
    expect(problems(text.replace('tier: must', 'tier: must\n    input: axis'))).toMatch(
      /input is for iRacing guides/
    );
  });
});

describe('the binding guide page’s data for Nuclear Option', () => {
  it('names Nuclear Option as a game it has a guide for, where the game has saved bindings', async () => {
    const a = await start();
    const games = await a.invoke<GuideGames>('ai-assist:games');
    expect(games.games.find((g) => g.id === 'nuclear-option')).toEqual({
      id: 'nuclear-option',
      name: 'Nuclear Option',
      available: true,
    });
    expect(await a.invoke<AircraftList>('ai-assist:aircraft', { game: 'nuclear-option' })).toEqual({
      game: 'nuclear-option',
      available: true,
      gameName: 'Nuclear Option',
      aircraft: [{ id: GUIDE, name: 'All aircraft', hasUserBindings: true, guide: 'shipped' }],
    });
    await a.cleanup();
    const none = (app = await wiredApp('generic-fresh', { files: [] }));
    expect(
      (await none.invoke<GuideGames>('ai-assist:games')).games.find(
        (g) => g.id === 'nuclear-option'
      )
    ).toEqual({ id: 'nuclear-option', name: 'Nuclear Option', available: false });
    expect(
      await none.invoke<AircraftList>('ai-assist:aircraft', { game: 'nuclear-option' })
    ).toEqual({
      game: 'nuclear-option',
      available: false,
      gameName: 'Nuclear Option',
      aircraft: [],
    });
  });

  it('every action the guide names is one the game has: no item is missing, and each name is found', async () => {
    const a = await start();
    const view = await guideOf(a);
    expect(view.game).toBe('nuclear-option');
    expect(view.aircraftName).toBe('All aircraft');
    expect(view.guide?.kind).toBe('shipped');
    const pack = shippedPack(GUIDE)!;
    const items = itemsOf(view);
    expect(items.map((i) => i.id).sort()).toEqual(pack.items.map((i) => i.id).sort());
    for (const item of pack.items) {
      const shown = items.find((i) => i.id === item.id)!;
      expect(shown.status, item.id).not.toBe('missing');
      // The guide names actions exactly, as the game's controls screen does: each is found.
      expect(
        shown.actions.map((x) => x.dcsName),
        item.id
      ).toEqual(item.actions.map((spec) => ('name' in spec ? spec.name : spec.re)));
      // Nothing is bound from the guide.
      expect(
        shown.actions.every((x) => !x.editable),
        item.id
      ).toBe(true);
    }
    expect(view.guide?.roles.map((r) => r.title)).toEqual([
      'Stick',
      'Throttle',
      'Pedals',
      'Panels and button boxes',
      'Keyboard',
    ]);
    expect(view.tiers.map((t) => t.title)).toEqual([
      'Must have to fly and fight',
      'Should have',
      'Nice to have',
    ]);
  });

  it('says of each item whether it is bound on a controller, from what the game saved', async () => {
    const a = await start();
    const items = itemsOf(await guideOf(a));
    const status = (id: string): string => items.find((i) => i.id === id)!.status;
    // The scenario's stick has pitch, roll and Fire; nothing has the navigation lights.
    expect(status('pitch-roll')).toBe('bound');
    expect(status('fire')).toBe('bound');
    expect(status('nav-lights')).toBe('unbound');
    const fire = items.find((i) => i.id === 'fire')!.actions[0]!;
    expect(fire.bound.map((b) => b.text)).toContain('Joystick - HOTAS Warthog · Button 1');
    // A binding made on the bindings page shows in the guide the next time it is read.
    await a.invoke('nuclear-option-bindings:change', {
      device: 'controller:044F:0402:0',
      actionId: 49,
      button: 12,
    });
    const after = itemsOf(await guideOf(a)).find((i) => i.id === 'nav-lights')!;
    expect(after.status).toBe('bound');
    expect(after.actions[0]!.bound.map((b) => b.text)).toEqual([
      'Joystick - HOTAS Warthog · Button 12',
    ]);
  });

  it('keeps the walkthrough’s progress, binds nothing, and makes no AI request', async () => {
    const a = await start();
    await a.invoke('ai-assist:setProgress', { aircraftId: GUIDE, itemId: 'fire', state: 'done' });
    expect((await guideOf(a)).progress.done).toEqual(['fire']);
    await expect(
      a.invoke('ai-assist:stage', {
        aircraftId: GUIDE,
        actionId: '5',
        deviceGuid: '00000000-0000-0000-0000-000000000000',
        input: 'JOY_BTN2',
      })
    ).rejects.toThrow('The guide does not bind in Nuclear Option');
    for (const kind of ['suggest', 'draft', 'explain', 'ask'] as const) {
      await expect(
        a.invoke('ai-assist:prepare', { kind, aircraftId: GUIDE, question: 'x', actionId: '5' }),
        kind
      ).rejects.toThrow('AI help is for DCS aircraft and iRacing cars');
    }
    await expect(a.invoke('ai-assist:startOwnGuide', { aircraftId: GUIDE })).rejects.toThrow(
      'RigReady includes the guide for Nuclear Option'
    );
    await expect(
      a.invoke('ai-assist:guide', { aircraftId: 'nuclear-option:cricket' })
    ).rejects.toThrow('one set of bindings for every aircraft');
    const journal = await a.ports.files.journalGroups();
    expect(journal.ok && journal.value).toEqual([]);
  });

  it('reads the same whether the game is open or closed: it only reads', async () => {
    const a = await start();
    const closed = itemsOf(await guideOf(a)).map((i) => [i.id, i.status]);
    await mutate(a, [
      { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
    ]);
    expect(itemsOf(await guideOf(a)).map((i) => [i.id, i.status])).toEqual(closed);
  });
});
