import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import { streamedMessage } from '../../../../tests/aiStream';
import type {
  AircraftList,
  AppliedView,
  GuideGames,
  GuideView,
  NuclearOptionReviewView,
  PlanView,
  Prepared,
  Sent,
} from './model';
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

  it('where the game is installed but has saved no bindings yet, says so plainly instead of a walkthrough that cannot bind', async () => {
    const a = await start('games-nuclear-option');
    const games = await a.invoke<GuideGames>('ai-assist:games');
    expect(games.games.find((g) => g.id === 'nuclear-option')?.available).toBe(true);
    expect(await a.invoke<AircraftList>('ai-assist:aircraft', { game: 'nuclear-option' })).toEqual({
      game: 'nuclear-option',
      available: true,
      gameName: 'Nuclear Option',
      aircraft: [],
      problem:
        'Nuclear Option has saved no bindings yet. Start the game once, and the guide fills in.',
    });
  });

  it('every action the walkthrough offers to bind is one the bindings feature takes: an axis for an axis action, a button and a key for the rest', async () => {
    const a = await start();
    const overview = await a.invoke<{ devices: { name: string; guid?: string }[] }>(
      'nuclear-option-bindings:overview'
    );
    const device = overview.devices.find((d) => d.name === 'Joystick - HOTAS Warthog')!.guid!;
    const offered = itemsOf(await guideOf(a)).flatMap((i) => i.actions.filter((x) => x.editable));
    expect(offered.length).toBeGreaterThan(30);
    const ask = (actionId: string, binding: object): Promise<NuclearOptionReviewView> =>
      a.invoke<NuclearOptionReviewView>('ai-assist:nuclearOptionBindPreview', {
        aircraftId: GUIDE,
        actionId,
        binding,
      });
    for (const action of offered) {
      // A preview that the bindings feature refused would reject here.
      if (action.kind === 'axis') {
        const shown = await ask(action.actionId, { kind: 'axis', device, axis: 'X' });
        expect(shown.after, action.dcsName).toBe('X axis');
        continue;
      }
      const shown = await ask(action.actionId, { kind: 'button', device, button: 19 });
      expect(shown.after, action.dcsName).toContain('Button 19');
      // The same action takes a key, in the keyboard's map; one that has two already says so.
      const onKey = await ask(action.actionId, { kind: 'key', code: 'F11' }).catch((e: Error) => e);
      if (onKey instanceof Error) expect(onKey.message, action.dcsName).toContain('two keys');
      else {
        expect(onKey.device, action.dcsName).toBe('the keyboard');
        expect(onKey.after, action.dcsName).toContain('F11');
      }
    }
    // The controller is found whatever case the press gives its id in.
    await expect(
      a.invoke('ai-assist:nuclearOptionBindPreview', {
        aircraftId: GUIDE,
        actionId: '49',
        binding: { kind: 'button', device: device.toLowerCase(), button: 19 },
      })
    ).resolves.toMatchObject({ after: 'Button 19' });
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
      // The walkthrough binds every action of the guide: an axis, a button or a key.
      for (const x of shown.actions) {
        expect(x.editable, x.dcsName).toBe(true);
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
      const onFire = await preview(a, '49', { kind: 'button', device, button: 1 });
      expect(onFire).toMatchObject({
        actionId: '49',
        label: 'Navigation lights on or off',
        device: 'Joystick - HOTAS Warthog',
        before: 'Not bound',
        after: 'Button 1',
        same: false,
        alsoOnButton: ['Fire'],
      });
      const shown = await preview(a, '49', { kind: 'button', device, button: 12 });
      expect(shown).toMatchObject({ after: 'Button 12', alsoOnButton: [] });
      expect(shown.preview.files).toHaveLength(1);
      // Nothing is written by looking.
      let journal = await a.ports.files.journalGroups();
      expect(journal.ok && journal.value).toEqual([]);

      const saved = await bind(a, '49', { kind: 'button', device, button: 12 }, shown.seen);
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
      expect((await preview(a, '49', { kind: 'button', device, button: 12 })).same).toBe(true);
      await a.invoke('safety:undo', { groupId: journal.value[0]!.id, force: false });
      expect(itemsOf(await guideOf(a)).find((i) => i.id === 'nav-lights')!.status).toBe('unbound');
    });

    it('binds an axis by moving it, reversed or not, one side of an axis to a button, and a key', async () => {
      const a = await start();
      const device = await stickGuid(a);
      const rows = async (): Promise<string[]> => {
        const view = await a.invoke<{
          devices: {
            name: string;
            bindings: {
              action: string;
              inputLabel: string;
              modifiers: string[];
              inverted: boolean;
            }[];
          }[];
        }>('nuclear-option-bindings:overview');
        return view.devices.flatMap((d) =>
          d.bindings.map(
            (b) =>
              `${d.name}: ${b.action} = ${[...b.modifiers, b.inputLabel].join(' + ')}${b.inverted ? ', reversed' : ''}`
          )
        );
      };
      // Yaw (2) has nothing on the stick: its X axis, reversed. The axis already rolls.
      const yaw = await preview(a, '2', { kind: 'axis', device, axis: 'X', invert: true });
      expect(yaw).toMatchObject({
        label: 'Yaw',
        before: 'Not bound',
        after: 'X axis, reversed',
        alsoOnButton: ['Roll Axis'],
      });
      expect(
        (await bind(a, '2', { kind: 'axis', device, axis: 'X', invert: true }, yaw.seen)).message
      ).toBe(
        'Saved: Yaw Axis is now on X axis, reversed of Joystick - HOTAS Warthog. Undo is on the Safety page.'
      );
      expect(await rows()).toContain('Joystick - HOTAS Warthog: Yaw Axis = X axis, reversed');
      // Zoom In (25:+) on a button, under the side's own name.
      const zoom = await preview(a, '25:+', { kind: 'button', device, button: 15 });
      expect(zoom).toMatchObject({ label: 'Zoom in', after: 'Button 15' });
      await bind(a, '25:+', { kind: 'button', device, button: 15 }, zoom.seen);
      expect(await rows()).toContain('Joystick - HOTAS Warthog: Zoom In = Button 15');
      // Toggle Engine (50) on Ctrl + F7, in the keyboard's map.
      const key = await preview(a, '50', { kind: 'key', code: 'F7', ctrl: true });
      expect(key).toMatchObject({
        device: 'the keyboard',
        before: 'Not bound',
        after: 'Ctrl + F7',
      });
      await bind(a, '50', { kind: 'key', code: 'F7', ctrl: true }, key.seen);
      expect(await rows()).toContain('Keyboard: Toggle Engine = Ctrl + F7');
      const items = itemsOf(await guideOf(a));
      expect(items.find((i) => i.id === 'yaw')!.status).toBe('bound');
      // An item that is fine on the keyboard counts a key as bound.
      const journal = await a.ports.files.journalGroups();
      if (!journal.ok) throw new Error(journal.error.message);
      expect(journal.value).toHaveLength(3);
    });

    it('is refused, with nothing written: the wrong kind of control for the action, an axis or a key the game has no number for, an action outside the guide, a controller the game saved nothing for, a map that changed, and while the game runs', async () => {
      const a = await start();
      const device = await stickGuid(a);
      // Pitch Axis (0) is an axis: it takes an axis, not a button or a key; a button action
      // takes no axis.
      await expect(preview(a, '0', { kind: 'button', device, button: 3 })).rejects.toThrow(
        'Pitch is an axis: move the lever, slider or stick you want for it.'
      );
      await expect(preview(a, '0', { kind: 'key', code: 'F7' })).rejects.toThrow(
        'Pitch is an axis'
      );
      await expect(preview(a, '49', { kind: 'axis', device, axis: 'X' })).rejects.toThrow(
        'needs a button or a key, not an axis'
      );
      // An axis the stick does not have, and a key RigReady cannot number.
      await expect(preview(a, '0', { kind: 'axis', device, axis: 'RZ' })).rejects.toThrow(
        'This controller has no axis called RZ'
      );
      await expect(preview(a, '49', { kind: 'key', code: 'IntlBackslash' })).rejects.toThrow(
        'RigReady does not know how the game numbers that key'
      );
      // Toggle debug graphs (39) is an action of the game, not of the guide.
      await expect(preview(a, '39', { kind: 'button', device, button: 3 })).rejects.toThrow(
        'That action is not in the guide shown here.'
      );
      await expect(
        preview(a, '49', {
          kind: 'button',
          device: '11111111-2222-3333-4444-555555555555',
          button: 3,
        })
      ).rejects.toThrow('Nuclear Option has saved no bindings for that controller yet');
      await expect(
        a.invoke('ai-assist:nuclearOptionBindPreview', {
          aircraftId: 'iracing:gt3',
          actionId: '49',
          binding: { kind: 'button', device, button: 3 },
        })
      ).rejects.toThrow('This binds Nuclear Option actions only.');

      // The saved map changed after the change was shown.
      const shown = await preview(a, '49', { kind: 'button', device, button: 12 });
      await a.invoke('nuclear-option-bindings:change', {
        device: 'controller:044F:0402:0',
        actionId: 52,
        button: 20,
      });
      await expect(
        bind(a, '49', { kind: 'button', device, button: 12 }, shown.seen)
      ).rejects.toThrow('changed after the change was shown');
      // While the game runs the review says why, and the save is refused.
      await mutate(a, [
        { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
      ]);
      const running = await preview(a, '49', { kind: 'button', device, button: 12 });
      expect(running.blocked).toContain('Close Nuclear Option first');
      await expect(
        bind(a, '49', { kind: 'button', device, button: 12 }, running.seen)
      ).rejects.toThrow('Close Nuclear Option first');
      const journal = await a.ports.files.journalGroups();
      if (!journal.ok) throw new Error(journal.error.message);
      // Only the change made on the bindings page itself.
      expect(journal.value).toHaveLength(1);
      expect(itemsOf(await guideOf(a)).find((i) => i.id === 'nav-lights')!.status).toBe('unbound');
    });
  });

  it('with a key, explains an action and answers a question from the game’s own data: the game named, no device id, the guide said to be unreviewed', async () => {
    const a = await start();
    await a.invoke('settings:setAiKey', { key: 'sk-ant-api03-SECRETSECRETSECRET-abcdEFGH' });
    const text = (t: string) => ({
      json: {
        model: 'claude-opus-5-5',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: t }],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    });
    a.ports.http.scripts.push({
      match: { url: '/v1/messages', body: 'Task: explain the Nuclear Option action' },
      response: { status: 200, headers: {}, ...text('It raises and lowers the wheels.') },
    });
    a.ports.http.scripts.push({
      match: { url: '/v1/messages', body: 'The player asks about their Nuclear Option setup' },
      response: { status: 200, headers: {}, ...text('Bind the gear first.') },
    });
    const explain = await a.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: GUIDE,
      kind: 'explain',
      actionId: '11',
    });
    expect(explain.contents[0]).toMatch(
      /^\d+ Nuclear Option actions, with what each is bound to now$/
    );
    expect(explain.contents[2]).toBe("RigReady's binding guide for Nuclear Option");
    expect(explain.body).toContain('You help a player of the combat flight game Nuclear Option');
    expect(explain.body).toContain('Nuclear Option: one set of bindings for every aircraft');
    expect(explain.body).toContain('not reviewed by the game');
    expect(explain.body).toContain('Toggle Gear');
    expect(explain.body).not.toContain('DCS');
    // What is bound is named as the app names it, not as the game's screen counts it: the
    // scenario's Fire is the stick's first button, which the game calls button 0.
    const body = JSON.stringify(JSON.parse(explain.body)).replace(/\\n/g, '\n');
    const row = (name: string): string =>
      body.split('\n').find((line) => line.includes(`| ${name} |`)) ?? '';
    expect(row('Fire')).toMatch(/dev\d:Button 1\b/);
    expect(row('Fire')).toContain('keyboard:Space');
    expect(row('Fire')).not.toContain('Button 0');
    expect(row('Pitch Axis')).toMatch(/dev\d:Y axis/);
    expect(row('Eject')).toContain('keyboard:Ctrl+Shift+E');
    // A binding on the mouse is not left out, as if the action had none.
    expect(body).toMatch(/\| mouse:/);
    // The controllers by name and by what they have, with no "used as": the game has no such thing.
    expect(body).toContain(
      '<devices columns=\\"ref | DirectInput name | buttons | hats | axes\\">'
    );
    expect(body).toMatch(/dev\d \| Joystick - HOTAS Warthog \| 19 \| 1 \| X axis, Y axis/);
    expect(body).toContain('mouse | Mouse | - | - | -');
    expect(body).toContain('fifth button');
    // No controller id, and nothing of the registry's value names.
    const overview = await a.invoke<{ devices: { guid?: string }[] }>(
      'nuclear-option-bindings:overview'
    );
    for (const device of overview.devices) {
      if (device.guid) expect(explain.body).not.toContain(device.guid);
    }
    expect(explain.body).not.toContain('RewiredSaveData');
    const explained = await a.invoke<Extract<Sent, { kind: 'answer' }>>('ai-assist:send', {
      requestId: explain.requestId,
    });
    expect(explained).toMatchObject({
      kind: 'answer',
      question: 'What does "Toggle Gear" do?',
      text: 'It raises and lowers the wheels.',
    });
    const ask = await a.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: GUIDE,
      kind: 'ask',
      question: 'What should I bind first?',
    });
    expect(ask.contents).toContain('Your question: "What should I bind first?"');
    const answered = await a.invoke<Extract<Sent, { kind: 'answer' }>>('ai-assist:send', {
      requestId: ask.requestId,
    });
    expect(answered.text).toBe('Bind the gear first.');
    await expect(
      a.invoke('ai-assist:prepare', { aircraftId: GUIDE, kind: 'explain', actionId: '999' })
    ).rejects.toThrow('has no such action');
  });

  it('with a key, suggests a setup: the answer is checked against the game and the controllers, reviewed as the bindings feature plans it, written as one change and undone', async () => {
    const a = await start();
    await a.invoke('settings:setAiKey', { key: 'sk-ant-api03-SECRETSECRETSECRET-abcdEFGH' });
    const values = async (): Promise<Record<string, unknown>> => {
      const all = await a.ports.registry.listValues('HKCU', 'Software\\Shockfront\\NuclearOption');
      if (!all.ok) throw new Error(all.error.message);
      return all.value;
    };
    const before = await values();
    const prepared = await a.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: GUIDE,
      kind: 'suggest',
    });
    expect(a.ports.http.calls).toEqual([]);
    expect(prepared.body).toContain(
      'Task: suggest how to bind Nuclear Option on these controllers.'
    );
    // The model is told what a suggestion does to the control it names, and what it may name.
    expect(prepared.body).toContain('A suggested control is taken over');
    expect(prepared.body).toContain('no hat, no key, no mouse button');
    expect(prepared.body).toContain('named as in <devices> and <actions>');
    expect(prepared.body).not.toContain('DCS');
    expect(prepared.body).not.toContain('RewiredSaveData');

    const item = (actionId: string, device: string, input: string) => ({
      actionId,
      device,
      input,
      priority: 'should',
      reason: 'Under the finger.',
    });
    a.ports.http.respond(
      'api.anthropic.com/v1/messages',
      streamedMessage(
        JSON.stringify({
          summary: 'Lights on the trigger, zoom on the throttle.',
          notes: [],
          items: [
            // The trigger does Fire now.
            item('49', 'dev1', 'Button 1'),
            // Bound so already: an axis by the name the bindings page gives it.
            item('0', 'dev1', 'Y axis'),
            item('38', 'dev2', 'Slider 1'),
            // One side of an axis action, on the button Toggle Gear is on.
            item('25:+', 'dev2', 'button 18'),
            // None of these checks out.
            item('5', 'dev1', 'JOY_BTN_POV1_U'),
            item('5', 'keyboard', 'F'),
            item('0', 'dev1', 'Button 2'),
            item('11', 'dev2', 'Z rotation'),
            item('2', 'dev1', 'Z rotation'),
            item('999', 'dev1', 'Button 3'),
            item('49', 'dev1', 'Button 77'),
          ],
        })
      )
    );
    const sent = await a.invoke<Extract<Sent, { kind: 'suggest' }>>('ai-assist:send', {
      requestId: prepared.requestId,
    });
    expect(JSON.stringify(JSON.parse(prepared.body))).toBe(a.ports.http.calls[0]!.body);
    expect(
      sent.suggestions.map((s) => [
        s.dcsName,
        s.deviceName,
        s.inputLabel,
        s.replaces,
        s.already,
        s.selected,
      ])
    ).toEqual([
      ['Toggle Navigation Lights', 'Joystick - HOTAS Warthog', 'Button 1', ['Fire'], false, true],
      ['Pitch Axis', 'Joystick - HOTAS Warthog', 'Y axis', [], true, false],
      ['Custom Axis 1', 'Throttle - HOTAS Warthog', 'Slider 1', [], true, false],
      ['Zoom In', 'Throttle - HOTAS Warthog', 'Button 18', ['Toggle Gear'], false, true],
    ]);
    expect(sent.dropped.map((d) => d.why)).toEqual([
      'RigReady does not bind a hat in Nuclear Option; bind one in the game',
      'no such controller',
      'an axis action needs an axis',
      'a button action cannot go on an axis',
      'that controller has no such input',
      'no such action in this game',
      'that controller has no such input',
    ]);
    // No id of a controller in what comes back to the window.
    const overview = await a.invoke<{ devices: { guid?: string }[] }>(
      'nuclear-option-bindings:overview'
    );
    for (const device of overview.devices) {
      if (device.guid) expect(prepared.body).not.toContain(device.guid);
    }

    // Nothing is written until reviewed: the review is the bindings feature's own plan.
    const plan = await a.invoke<PlanView>('ai-assist:reviewSuggestions', {
      roundId: sent.roundId,
      selected: ['s1', 's2', 's4'],
    });
    expect(plan.summary).toBe('Bind 3 actions suggested by AI');
    expect(plan.files.map((file) => [file.title, file.lines])).toEqual([
      [
        'Nuclear Option’s saved bindings for Joystick - HOTAS Warthog (registry)',
        ['Toggle Navigation Lights: Button 1', 'Button 1 no longer does Fire'],
      ],
      [
        'Nuclear Option’s saved bindings for Throttle - HOTAS Warthog (registry)',
        ['Zoom In: Button 18 (was Button 7)', 'Button 18 no longer does Toggle Gear'],
      ],
    ]);
    expect(plan.notes).toEqual(['1 of these is bound so already and is left as it is.']);
    expect(await values()).toEqual(before);
    await expect(
      a.invoke('ai-assist:reviewSuggestions', { roundId: sent.roundId, selected: [] })
    ).rejects.toThrow(/Tick at least one/);

    const applied = await a.invoke<AppliedView>('ai-assist:applySuggestions', {
      roundId: sent.roundId,
      selected: ['s1', 's2', 's4'],
    });
    expect(applied).toMatchObject({ summary: 'Bind 3 actions suggested by AI', files: 2 });
    const journal = await a.ports.files.journalGroups();
    if (!journal.ok) throw new Error(journal.error.message);
    expect(journal.value.map((g) => [g.id, g.reason, g.entries.length])).toEqual([
      [applied.groupId, 'Nuclear Option bindings: Bind 3 actions suggested by AI', 2],
    ]);
    // The guide reads the new bindings: the lights are bound now.
    expect(itemsOf(await guideOf(a)).find((i) => i.id === 'nav-lights')!.status).toBe('bound');
    // The pitch axis, suggested where it is, kept the reversal the player gave it.
    const now = await a.invoke<{
      devices: { name: string; bindings: { action: string; inputLabel: string }[] }[];
    }>('nuclear-option-bindings:overview');
    const stick = now.devices.find((d) => d.name === 'Joystick - HOTAS Warthog')!;
    expect(stick.bindings.find((b) => b.action === 'Pitch Axis')).toMatchObject({
      inputLabel: 'Y axis',
      inverted: true,
    });
    expect(stick.bindings.some((b) => b.action === 'Fire')).toBe(false);

    // Undo is the Nuclear Option bindings feature's: refused while that game runs.
    await mutate(a, [
      { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
    ]);
    await expect(a.invoke('ai-assist:undo', { groupId: applied.groupId })).rejects.toThrow(
      'Close Nuclear Option first'
    );
    await mutate(a, [{ op: 'stopProcess', name: 'NuclearOption.exe' }]);
    expect(await a.invoke('ai-assist:undo', { groupId: applied.groupId })).toEqual({
      undone: true,
    });
    expect(await values()).toEqual(before);
  });

  it('a suggestion is not asked for with no controller of the game’s connected, and ticked ones that fight over a control are refused', async () => {
    const a = await start();
    await a.invoke('settings:setAiKey', { key: 'sk-ant-api03-SECRETSECRETSECRET-abcdEFGH' });
    const item = (actionId: string, input: string) => ({
      actionId,
      device: 'dev1',
      input,
      priority: 'must',
      reason: 'x',
    });
    a.ports.http.respond(
      'api.anthropic.com/v1/messages',
      streamedMessage(
        JSON.stringify({
          summary: 'Two on one button.',
          notes: [],
          items: [item('49', 'Button 12'), item('52', 'Button 12')],
        })
      )
    );
    const prepared = await a.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: GUIDE,
      kind: 'suggest',
    });
    const sent = await a.invoke<Extract<Sent, { kind: 'suggest' }>>('ai-assist:send', {
      requestId: prepared.requestId,
    });
    expect(sent.suggestions.map((s) => [s.clashesWith, s.selected])).toEqual([
      [['s2'], false],
      [['s1'], false],
    ]);
    await expect(
      a.invoke('ai-assist:reviewSuggestions', { roundId: sent.roundId, selected: ['s1', 's2'] })
    ).rejects.toThrow(/both use Button 12 on Joystick - HOTAS Warthog\. Untick one\./);
    await expect(
      a.invoke('ai-assist:applySuggestions', { roundId: sent.roundId, selected: ['s1', 's2'] })
    ).rejects.toThrow(/Untick one/);
    // With every controller unplugged there is nothing to suggest on, and no request is made.
    const calls = a.ports.http.calls.length;
    await mutate(a, [
      { op: 'unplugDevice', match: { vendorId: '044F', productId: '0402' } },
      { op: 'unplugDevice', match: { vendorId: '044F', productId: '0404' } },
    ]);
    await expect(
      a.invoke('ai-assist:prepare', { aircraftId: GUIDE, kind: 'suggest' })
    ).rejects.toThrow('No controller that Nuclear Option has saved bindings for is connected');
    expect(a.ports.http.calls).toHaveLength(calls);
    const journal = await a.ports.files.journalGroups();
    expect(journal.ok && journal.value).toEqual([]);
  });

  it('keeps the walkthrough’s progress, stages nothing, and does not draft a guide', async () => {
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
    ).rejects.toThrow('In Nuclear Option the guide binds one control at a time');
    // A drafted guide is not for this game, said before any key is looked at.
    await expect(
      a.invoke('ai-assist:prepare', { kind: 'draft', aircraftId: GUIDE })
    ).rejects.toThrow('RigReady includes the guide for Nuclear Option');
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
