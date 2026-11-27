import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { AircraftList, GuideGames, GuideView, NuclearOptionReviewView } from './model';
import { GAME_ROLES, gameOfKey, guideKey, packText, parsePack, TIERS } from './pack';
import { shippedPack } from './shipped';

/**
 * The binding guide for Nuclear Option: one guide for every aircraft, on the bindings the
 * game saved (fixtures/scenarios/nuclear-option-bindings.yaml). It shows what is bound and
 * what is not, and binds a controller button through the Nuclear Option bindings feature.
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
      // The walkthrough binds a button-type action; an axis, and one side of an axis
      // ("Zoom In", "Apply Brakes"), are bound in the game.
      for (const x of shown.actions) {
        expect(x.editable, x.dcsName).toBe(x.kind === 'button' && /^\d+$/.test(x.actionId));
      }
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

  describe('binding from the walkthrough', () => {
    /** The scenario's stick, by its DirectInput instance GUID as a press gives it. */
    const stickGuid = async (a: WiredApp): Promise<string> => {
      const view = await a.invoke<{ devices: { name: string; guid?: string }[] }>(
        'nuclear-option-bindings:overview'
      );
      return view.devices.find((d) => d.name === 'Joystick - HOTAS Warthog')!.guid!;
    };
    const preview = (a: WiredApp, actionId: string, binding: object) =>
      a.invoke<NuclearOptionReviewView>('ai-assist:nuclearOptionBindPreview', {
        aircraftId: GUIDE,
        actionId,
        binding,
      });
    const bind = (a: WiredApp, actionId: string, binding: object, seen: string) =>
      a.invoke<{ changed: boolean; message: string }>('ai-assist:nuclearOptionBind', {
        aircraftId: GUIDE,
        actionId,
        binding,
        seen,
      });

    it('shows the change first, then saves it through the bindings feature, with Undo on the Safety page', async () => {
      const a = await start();
      const device = await stickGuid(a);
      // Toggle Navigation Lights (49) to button 1, where Fire is.
      const onFire = await preview(a, '49', { device, button: 1 });
      expect(onFire).toMatchObject({
        actionId: '49',
        label: 'Navigation lights on or off',
        device: 'Joystick - HOTAS Warthog',
        before: 'Not bound',
        after: 'Button 1',
        same: false,
        alsoOnButton: ['Fire'],
      });
      const shown = await preview(a, '49', { device, button: 12 });
      expect(shown).toMatchObject({ after: 'Button 12', alsoOnButton: [] });
      expect(shown.preview.files).toHaveLength(1);
      // Nothing is written by looking.
      let journal = await a.ports.files.journalGroups();
      expect(journal.ok && journal.value).toEqual([]);

      const saved = await bind(a, '49', { device, button: 12 }, shown.seen);
      expect(saved).toEqual({
        changed: true,
        message:
          'Saved: Toggle Navigation Lights is now on Button 12 of Joystick - HOTAS Warthog. Undo is on the Safety page.',
      });
      const item = itemsOf(await guideOf(a)).find((i) => i.id === 'nav-lights')!;
      expect(item.status).toBe('bound');
      journal = await a.ports.files.journalGroups();
      if (!journal.ok) throw new Error(journal.error.message);
      expect(journal.value.map((g) => g.reason)).toEqual([
        'Nuclear Option bindings: Toggle Navigation Lights bound to Button 12 on Joystick - HOTAS Warthog',
      ]);
      // The same press again: nothing to save.
      expect((await preview(a, '49', { device, button: 12 })).same).toBe(true);
      await a.invoke('safety:undo', { groupId: journal.value[0]!.id, force: false });
      expect(itemsOf(await guideOf(a)).find((i) => i.id === 'nav-lights')!.status).toBe('unbound');
    });

    it('is refused, with nothing written: an axis, one side of an axis, an action outside the guide, a controller the game saved nothing for, a map that changed, and while the game runs', async () => {
      const a = await start();
      const device = await stickGuid(a);
      // Pitch Axis (0) is an axis; Zoom In (25:+) is one side of one.
      await expect(preview(a, '0', { device, button: 3 })).rejects.toThrow(
        'Bind it in the game: Settings, then Controls'
      );
      await expect(preview(a, '25:+', { device, button: 3 })).rejects.toThrow(
        'Bind it in the game: Settings, then Controls'
      );
      // Toggle debug graphs (39) is an action of the game, not of the guide.
      await expect(preview(a, '39', { device, button: 3 })).rejects.toThrow(
        'That action is not in the guide shown here.'
      );
      await expect(
        preview(a, '49', { device: '11111111-2222-3333-4444-555555555555', button: 3 })
      ).rejects.toThrow('Nuclear Option has saved no bindings for that controller yet');
      await expect(
        a.invoke('ai-assist:nuclearOptionBindPreview', {
          aircraftId: 'iracing:gt3',
          actionId: '49',
          binding: { device, button: 3 },
        })
      ).rejects.toThrow('This binds Nuclear Option actions only.');

      // The saved map changed after the change was shown.
      const shown = await preview(a, '49', { device, button: 12 });
      await a.invoke('nuclear-option-bindings:change', {
        device: 'controller:044F:0402:0',
        actionId: 52,
        button: 20,
      });
      await expect(bind(a, '49', { device, button: 12 }, shown.seen)).rejects.toThrow(
        'changed after the change was shown'
      );
      // While the game runs the review says why, and the save is refused.
      await mutate(a, [
        { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
      ]);
      const running = await preview(a, '49', { device, button: 12 });
      expect(running.blocked).toContain('Close Nuclear Option first');
      await expect(bind(a, '49', { device, button: 12 }, running.seen)).rejects.toThrow(
        'Close Nuclear Option first'
      );
      const journal = await a.ports.files.journalGroups();
      if (!journal.ok) throw new Error(journal.error.message);
      // Only the change made on the bindings page itself.
      expect(journal.value).toHaveLength(1);
      expect(itemsOf(await guideOf(a)).find((i) => i.id === 'nav-lights')!.status).toBe('unbound');
    });
  });

  it('keeps the walkthrough’s progress, stages nothing, and makes no AI request', async () => {
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
    ).rejects.toThrow('In Nuclear Option the guide binds one button at a time');
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
