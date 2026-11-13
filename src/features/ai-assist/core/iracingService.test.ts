import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { streamedMessage } from '../../../../tests/aiStream';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import { ok } from '../../../core/result';
import { iracingThroughChannels } from './iracing';
import type {
  AircraftList,
  GuideGames,
  GuideView,
  IracingReviewView,
  Prepared,
  Sent,
} from './model';
import { parsePack } from './pack';
import { AiAssist } from './service';

/**
 * The binding guide for iRacing, on the real path: the guide reads iRacing's bindings and
 * binds through the iRacing bindings feature's own channels, which read and write the control
 * profile iRacing uses (fixtures/scenarios/ai-assist-iracing.yaml).
 */

/** The wheel base of the recorded rig (a made-up id): connected, 108 buttons. */
const WHEEL = '45D4BEA1-60A1-17D8-8001-444553540000';
const GT3 = 'iracing:gt3';
const PORSCHE = 'iracing:car:porsche992rgt3';
const CADILLAC = 'iracing:car:cadillacctsvr';
const KEY = 'sk-ant-api03-SECRETSECRETSECRET-abcdEFGH';

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

async function start(scenario = 'ai-assist-iracing'): Promise<WiredApp> {
  app = await wiredApp(scenario, {
    files: ['Documents/iRacing/**', 'Program Files (x86)/iRacing/**'],
  });
  return app;
}

const guideOf = (a: WiredApp, id: string): Promise<GuideView> =>
  a.invoke<GuideView>('ai-assist:guide', { aircraftId: id });
const itemOf = (view: GuideView, id: string) =>
  view.tiers.flatMap((t) => t.items).find((i) => i.id === id)!;
const profile = (a: WiredApp, name = 'Baseline'): string =>
  path.join(a.ports.folders.documents(), 'iRacing', 'profiles', 'controls', name, 'controls.cfg');
const bindingIn = async (a: WiredApp, set: string, action: string) =>
  (
    await a.invoke<{ actions: { id: string; name: string; binding?: { input: string } }[] }>(
      'iracing-bindings:set',
      { id: set }
    )
  ).actions.find((x) => x.id === action);

describe('the binding guide for iRacing: classes and cars', () => {
  it('names iRacing as a game it has guides for, where iRacing is found', async () => {
    const a = await start();
    const games = await a.invoke<GuideGames>('ai-assist:games');
    expect(games.games.find((g) => g.id === 'iracing')).toEqual({
      id: 'iracing',
      name: 'iRacing',
      available: true,
    });
    await a.cleanup();
    const none = (app = await wiredApp('generic-fresh', { files: [] }));
    expect((await none.invoke<GuideGames>('ai-assist:games')).games).toEqual([
      { id: 'dcs', name: 'DCS World', available: false },
      { id: 'iracing', name: 'iRacing', available: false },
    ]);
    expect(
      await none.invoke<AircraftList>('ai-assist:aircraft', { game: 'iracing' })
    ).toMatchObject({ available: false, aircraft: [] });
  });

  it('says plainly, with no error, when iRacing is installed but its controls were never set up', async () => {
    const a = (app = await wiredApp('shell-racing-pc', { files: [] }));
    expect(await a.invoke<AircraftList>('ai-assist:aircraft', { game: 'iracing' })).toEqual({
      game: 'iracing',
      available: true,
      gameName: 'iRacing',
      aircraft: [],
      problem:
        'iRacing has no bindings file yet. Set up your controls in iRacing once, and the guide fills in.',
    });
  });

  it('lists the six classes, then each car with controls of its own; a car named for its class uses that guide', async () => {
    const a = await start();
    const list = await a.invoke<AircraftList>('ai-assist:aircraft', { game: 'iracing' });
    expect(list).toMatchObject({ game: 'iracing', available: true, gameName: 'iRacing' });
    expect(list.aircraft.map((e) => [e.id, e.name, e.guide, e.uses])).toEqual([
      [GT3, 'GT3', 'shipped', undefined],
      ['iracing:gt4', 'GT4', 'shipped', undefined],
      ['iracing:prototypes', 'LMDh and prototypes', 'shipped', undefined],
      ['iracing:formula', 'Formula and open-wheel', 'shipped', undefined],
      ['iracing:oval', 'Oval', 'shipped', undefined],
      ['iracing:dirt', 'Dirt', 'shipped', undefined],
      [CADILLAC, 'cadillacctsvr (own controls)', null, undefined],
      ['iracing:car:ferrari296gt3', 'ferrari296gt3 (own controls)', 'shipped', 'GT3'],
      [PORSCHE, 'porsche992rgt3 (own controls)', 'shipped', 'GT3'],
    ]);
    // DCS's list is asked for apart and stays what it was.
    expect((await a.invoke<AircraftList>('ai-assist:aircraft')).game).toBe('dcs');

    const porsche = await guideOf(a, PORSCHE);
    expect(porsche.guide).toMatchObject({
      kind: 'shipped',
      suggested: { className: 'GT3', token: 'gt3' },
    });
    expect(porsche.iracing).toMatchObject({
      set: 'car:porsche992rgt3',
      setName: 'porsche992rgt3',
      profile: 'GT3 Cars',
    });
    // The two GT3 cars share one profile: a change for one is for both, and the review says so.
    const review = await a.invoke<IracingReviewView>('ai-assist:iracingBindPreview', {
      aircraftId: PORSCHE,
      actionId: 'HeadlightFlash',
      binding: { kind: 'button', device: WHEEL, button: 44 },
    });
    expect(review.forCars).toBe('porsche992rgt3 and ferrari296gt3, which share one profile');
    const cadillac = await guideOf(a, CADILLAC);
    expect(cadillac.guide).toBeNull();
    expect(cadillac.iracing).toMatchObject({
      setName: 'cadillacctsvr',
      profile: 'Test Profile CTSV',
    });
  });

  it('shows a class guide against the bindings for all cars: bound, not bound, or bind in iRacing', async () => {
    const a = await start();
    const view = await guideOf(a, GT3);
    expect(view.game).toBe('iracing');
    expect(view.aircraftName).toBe('GT3');
    expect(view.iracing).toEqual({
      set: 'all',
      setName: 'All cars',
      profile: 'Baseline',
      simRunning: false,
      notes: [],
    });
    expect(view.tiers.map((t) => t.title)).toEqual([
      'Must have to drive and race',
      'Should have',
      'Nice to have',
    ]);
    expect(view.guide!.roles.map((r) => r.title)).toEqual([
      'Wheel rim',
      'Pedals',
      'Button box',
      'Keyboard',
    ]);
    // The axes iRacing has bound: bound, though RigReady never binds them.
    const steering = itemOf(view, 'steering');
    expect(steering).toMatchObject({
      status: 'bound',
      placeTitle: 'On the wheel, pedals or shifter',
    });
    expect(steering.actions.map((x) => [x.dcsName, x.label, x.kind, x.editable])).toEqual([
      ['SteerLeft', 'Steer left', 'axis', false],
      ['SteerRight', 'Steer right', 'axis', false],
    ]);
    // The throttle takes a button too, but the guide puts it on an axis: bound in iRacing.
    expect(itemOf(view, 'throttle').actions[0]).toMatchObject({ kind: 'axis', editable: false });
    // The clutch axis is not bound in this profile: only iRacing can bind it.
    expect(itemOf(view, 'clutch').status).toBe('inGame');
    // The paddles are bound on the wheel; the pit limiter only on the keyboard, which a rim
    // item does not count; the headlight flash not at all. Both can be bound from here.
    expect(itemOf(view, 'shift').status).toBe('bound');
    const limiter = itemOf(view, 'pit-limiter');
    expect(limiter.status).toBe('unbound');
    expect(limiter.actions[0]).toMatchObject({ dcsName: 'PitSpeedLimiter', editable: true });
    expect(limiter.actions[0]!.bound).toMatchObject([{ keyboard: true }]);
    expect(itemOf(view, 'headlights')).toMatchObject({ status: 'unbound' });
    expect(itemOf(view, 'headlights').actions[0]!.bound).toEqual([]);
  });

  it('labels iRacing actions plainly on the iRacing bindings page and for the cheat sheets, iRacing’s id beside', async () => {
    const a = await start();
    // The page's own name would be "Dash page up".
    expect(await bindingIn(a, 'all', 'DashPageInc')).toMatchObject({
      id: 'DashPageInc',
      name: 'Next dash page',
    });
    // An action no guide names keeps the iRacing bindings page's own name.
    expect((await bindingIn(a, 'all', 'CamFOVInc'))!.name).toBe('Camera field of view up');
    const labels = await a.wiring.context.bindings.labels('iracing', 'all');
    expect(labels['BrakeBiasInc']).toBe('Brake bias up');
    expect(labels['DRS']).toBe('DRS');
    expect(labels['TearOffVisor']).toBe('Tear off visor');
  });

  it('is told apart from DCS for staging: iRacing binds one action at a time', async () => {
    const a = await start();
    await expect(
      a.invoke('ai-assist:stage', {
        aircraftId: GT3,
        actionId: 'HeadlightFlash',
        deviceGuid: WHEEL,
        input: 'JOY_BTN40',
      })
    ).rejects.toThrow(/one action at a time/);
  });
});

describe('the walkthrough binds iRacing buttons and keys through the iRacing bindings feature', () => {
  it('binds a wheel button: shown first, then written to the profile iRacing uses, with Undo', async () => {
    const a = await start();
    const file = profile(a);
    const bytes = await fs.readFile(file);
    const request = {
      aircraftId: GT3,
      actionId: 'HeadlightFlash',
      binding: { kind: 'button' as const, device: WHEEL, button: 40 },
    };
    const review = await a.invoke<IracingReviewView>('ai-assist:iracingBindPreview', request);
    expect(review).toMatchObject({
      actionId: 'HeadlightFlash',
      label: 'Flash headlights',
      forCars: 'All cars',
      before: 'Not bound',
      same: false,
      conflicts: [],
    });
    expect(review.after).toMatch(/^Button 40 on /);
    expect(review.blocked).toBeUndefined();
    expect(review.preview.files.map((f) => [f.path, f.change])).toEqual([[file, 'modified']]);
    // The preview wrote nothing.
    expect((await fs.readFile(file)).equals(bytes)).toBe(true);

    const saved = await a.invoke<{ changed: boolean; message: string }>('ai-assist:iracingBind', {
      ...request,
      seen: review.seen,
    });
    expect(saved.changed).toBe(true);
    expect(saved.message).toMatch(/^Saved in iRacing’s file for all cars: Flash headlights/);
    expect((await bindingIn(a, 'all', 'HeadlightFlash'))!.binding?.input).toBe('Button 40');
    expect(itemOf(await guideOf(a, GT3), 'headlights').status).toBe('bound');
    // One change on the Safety page, with the file backed up first.
    const journal = await a.ports.files.journal();
    if (!journal.ok) throw new Error(journal.error.message);
    const entry = journal.value.find((e) => e.path === file)!;
    expect(entry).toBeDefined();
    const undone = await a.invoke<{ ok?: boolean }>('safety:undo', { groupId: entry.groupId });
    expect(undone).toBeDefined();
    expect((await fs.readFile(file)).equals(bytes)).toBe(true);
  });

  it('binds a key as iRacing stores it, and says why a key it cannot bind is refused', async () => {
    const a = await start();
    const key = {
      kind: 'keyPress' as const,
      key: 'J',
      code: 'KeyJ',
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
    };
    const request = { aircraftId: GT3, actionId: 'BlackBoxShowNext', binding: key };
    const review = await a.invoke<IracingReviewView>('ai-assist:iracingBindPreview', request);
    expect(review).toMatchObject({ label: 'Next black box', before: 'Not bound' });
    expect(review.after).toMatch(/Shift\+J/);
    await a.invoke('ai-assist:iracingBind', { ...request, seen: review.seen });
    expect((await bindingIn(a, 'all', 'BlackBoxShowNext'))!.binding?.input).toMatch(/Shift\+J/);

    await expect(
      a.invoke('ai-assist:iracingBindPreview', {
        ...request,
        binding: { ...key, key: '1', code: 'Numpad1', shiftKey: false },
      })
    ).rejects.toThrow(/number pad keys/);
    await expect(
      a.invoke('ai-assist:iracingBindPreview', {
        ...request,
        binding: { ...key, key: 'Shift', code: 'ShiftLeft' },
      })
    ).rejects.toThrow(/Press the key that goes with Shift, Ctrl or Alt/);
  });

  it('never binds an axis item, an action the guide does not name, or a file that changed since it was shown', async () => {
    const a = await start();
    const button = { kind: 'button' as const, device: WHEEL, button: 41 };
    await expect(
      a.invoke('ai-assist:iracingBindPreview', {
        aircraftId: GT3,
        actionId: 'Throttle',
        binding: button,
      })
    ).rejects.toThrow(/belongs on an axis\. Bind it in iRacing: Options, then Controls/);
    await expect(
      a.invoke('ai-assist:iracingBindPreview', {
        aircraftId: GT3,
        actionId: 'Pause',
        binding: button,
      })
    ).rejects.toThrow(/not in the guide shown here/);
    // A DCS aircraft is not bound this way.
    await expect(
      a.invoke('ai-assist:iracingBindPreview', {
        aircraftId: 'FA-18C_hornet',
        actionId: 'x',
        binding: button,
      })
    ).rejects.toThrow(/iRacing actions only/);

    const request = { aircraftId: GT3, actionId: 'ABSInc', binding: button };
    const review = await a.invoke<IracingReviewView>('ai-assist:iracingBindPreview', request);
    // Something else changes the file meanwhile.
    await a.invoke('iracing-bindings:change', {
      set: 'all',
      action: 'ABSDec',
      binding: { kind: 'button', device: WHEEL, button: 42 },
    });
    await expect(
      a.invoke('ai-assist:iracingBind', { ...request, seen: review.seen })
    ).rejects.toThrow(/changed after the change was shown/);
    expect((await bindingIn(a, 'all', 'ABSInc'))!.binding).toBeUndefined();
  });

  it('saves nothing while the simulator runs, and says why', async () => {
    const a = await start();
    await mutate(a, [
      {
        op: 'startProcess',
        name: 'iRacingSim64DX11.exe',
        path: 'C:\\iRacing\\iRacingSim64DX11.exe',
      },
    ]);
    const view = await guideOf(a, GT3);
    expect(view.iracing?.simRunning).toBe(true);
    const request = {
      aircraftId: GT3,
      actionId: 'HeadlightFlash',
      binding: { kind: 'button' as const, device: WHEEL, button: 40 },
    };
    const review = await a.invoke<IracingReviewView>('ai-assist:iracingBindPreview', request);
    expect(review.blocked).toMatch(/Close iRacing first/);
    const bytes = await fs.readFile(profile(a));
    await expect(
      a.invoke('ai-assist:iracingBind', { ...request, seen: review.seen })
    ).rejects.toThrow(/Close iRacing first/);
    expect((await fs.readFile(profile(a))).equals(bytes)).toBe(true);
  });

  it('binds into a car’s own profile when the guide is for that car', async () => {
    const a = await start();
    const request = {
      aircraftId: CADILLAC,
      actionId: 'PitSpeedLimiter',
      binding: { kind: 'button' as const, device: WHEEL, button: 43 },
    };
    // No guide for that car yet: nothing of it to bind.
    await expect(a.invoke('ai-assist:iracingBindPreview', request)).rejects.toThrow(
      /not in the guide shown here/
    );
    expect(await a.invoke('ai-assist:startOwnGuide', { aircraftId: CADILLAC })).toEqual({
      started: true,
    });
    const own = await guideOf(a, CADILLAC);
    expect(own.guide?.kind).toBe('own');
    const review = await a.invoke<IracingReviewView>('ai-assist:iracingBindPreview', request);
    expect(review.preview.files[0]!.path).toBe(profile(a, 'Test Profile CTSV'));
    expect(review.forCars).toBe('cadillacctsvr only');
    const saved = await a.invoke<{ message: string }>('ai-assist:iracingBind', {
      ...request,
      seen: review.seen,
    });
    expect(saved.message).toMatch(/for cadillacctsvr/);
    expect((await bindingIn(a, 'car:cadillacctsvr', 'PitSpeedLimiter'))!.binding?.input).toBe(
      'Button 43'
    );
    // The bindings for all cars are as they were.
    expect((await bindingIn(a, 'all', 'PitSpeedLimiter'))!.binding?.input).not.toBe('Button 43');
  });

  it('says so, and binds nothing, when the iRacing bindings answer in a form it does not know', async () => {
    const a = await start();
    const real = iracingThroughChannels((channel, input) =>
      a.wiring.context.invoke(channel, input)
    );
    // The set read as it is, but the overview with a field the guide needs gone.
    const odd = iracingThroughChannels(async (channel, input) => {
      const answer = await a.wiring.context.invoke(channel, input);
      return channel === 'iracing-bindings:overview' && answer.ok
        ? ok({ ...(answer.value as object), sets: 'all' })
        : answer;
    });
    expect(await odd.overview()).toMatchObject({ ok: false, error: { code: 'ai.iracingAnswer' } });
    expect((await real.overview()).ok).toBe(true);
    const guide = new AiAssist({
      ports: a.ports,
      log: a.ctx.log,
      bindings: a.wiring.context.bindings,
      iracing: odd,
    });
    expect(await guide.aircraft('iracing')).toMatchObject({
      ok: false,
      error: {
        message: 'The iRacing bindings answered in a form the binding guide does not know.',
      },
    });
    const bytes = await fs.readFile(profile(a));
    expect(
      await guide.iracingPreview(GT3, 'HeadlightFlash', {
        kind: 'button',
        device: WHEEL,
        button: 40,
      })
    ).toMatchObject({ ok: false });
    expect((await fs.readFile(profile(a))).equals(bytes)).toBe(true);
  });
});

describe('a guide of your own, and one drafted by AI, for an iRacing car', () => {
  it('starts a guide of your own for a car, and refuses one for a class or from another game', async () => {
    const a = await start();
    await expect(a.invoke('ai-assist:startOwnGuide', { aircraftId: GT3 })).rejects.toThrow(
      /includes a guide for this class/
    );
    await a.invoke('ai-assist:startOwnGuide', { aircraftId: CADILLAC });
    const file = path.join(
      a.ports.folders.dataRoot(),
      'ai-assist',
      'guides',
      'iracing_car_cadillacctsvr.yaml'
    );
    const text = await fs.readFile(file, 'utf8');
    expect(text).toContain('# Your own iRacing binding guide for cadillacctsvr');
    const parsed = parsePack(text);
    if (!parsed.ok) throw new Error(parsed.error.detail);
    expect(parsed.value).toMatchObject({ game: 'iracing', aircraft: { id: 'car:cadillacctsvr' } });
    const view = await guideOf(a, CADILLAC);
    expect(itemOf(view, 'throttle')).toMatchObject({ status: 'bound' });
    expect(itemOf(view, 'pit-limiter').actions[0]!.editable).toBe(true);
    // The car's own guide names its labels first for its own set: what the file says now.
    const mine = text.replace(/label: Pit speed limiter$/m, 'label: My limiter');
    expect(mine).not.toBe(text);
    await fs.writeFile(file, mine);
    expect(
      (await a.wiring.context.bindings.labels('iracing', 'car:cadillacctsvr'))['PitSpeedLimiter']
    ).toBe('My limiter');
    expect((await a.wiring.context.bindings.labels('iracing', 'all'))['PitSpeedLimiter']).toBe(
      'Pit speed limiter'
    );

    // A DCS guide imported for an iRacing car is refused, and says why.
    await fs.rm(file);
    const dcs = path.join(a.home, 'Documents', 'hornet.yaml');
    await fs.writeFile(
      dcs,
      'format: 1\naircraft: { id: FA-18C_hornet, name: Hornet }\nsummary: S.\nsources: [x]\nroles: { stick: { summary: S., items: [a] } }\nitems:\n  - { id: a, title: A, tier: must, place: hotas, role: stick, what: What it does., when: Always., actions: [{ name: Pitch, label: Pitch }] }\n'
    );
    a.ports.dialogs.script.open.push([dcs]);
    await expect(a.invoke('ai-assist:importGuide', { aircraftId: CADILLAC })).rejects.toThrow(
      /That guide is for DCS World\. The guide shown here is for iRacing\./
    );
  });

  it('drafts a guide for a car with AI, every action checked against iRacing’s list, axes left to iRacing', async () => {
    const a = await start();
    await a.invoke('settings:setAiKey', { key: KEY });
    a.ports.http.scripts.push({
      match: { url: '/v1/messages', body: 'write an iRacing binding guide' },
      response: {
        status: 200,
        headers: {},
        ...streamedMessage(
          JSON.stringify({
            summary: 'A touring car.',
            items: [
              {
                title: 'Throttle',
                tier: 'must',
                place: 'rim',
                role: 'pedals',
                what: 'The throttle.',
                when: 'Always.',
                actionIds: ['Throttle'],
                axis: true,
              },
              {
                title: 'Pit limiter',
                tier: 'must',
                place: 'rim',
                role: 'wheel',
                what: 'The pit limiter.',
                when: 'In the pits.',
                actionIds: ['PitSpeedLimiter'],
                axis: false,
              },
              // Not an iRacing action: left out.
              {
                title: 'Gear',
                tier: 'must',
                place: 'rim',
                role: 'wheel',
                what: 'Lowers the gear.',
                when: 'Landing.',
                actionIds: ['GearDown'],
                axis: false,
              },
              // A DCS place: left out.
              {
                title: 'Trim',
                tier: 'nice',
                place: 'hotas',
                role: 'stick',
                what: 'Trims.',
                when: 'Always.',
                actionIds: ['Starter'],
                axis: false,
              },
            ],
          })
        ),
      },
    });
    await expect(a.invoke('ai-assist:prepare', { aircraftId: GT3, kind: 'draft' })).rejects.toThrow(
      /includes a guide for this class/
    );
    await expect(
      a.invoke('ai-assist:prepare', { aircraftId: GT3, kind: 'suggest' })
    ).rejects.toThrow(/Suggest a setup is for DCS aircraft/);
    const draft = await a.invoke<Prepared>('ai-assist:prepare', {
      aircraftId: CADILLAC,
      kind: 'draft',
    });
    expect(draft.contents[0]).toBe(
      '369 iRacing actions, with what each is bound to now in the bindings for cadillacctsvr'
    );
    expect(draft.contents[2]).toBe('No guide (there is none for this car)');
    // What is sent names iRacing's ids, not the names the owner gave, nor a device id.
    expect(draft.body).toContain('iRacing: cadillacctsvr (own controls)');
    expect(draft.body).toContain('PitSpeedLimiter | button | yes |');
    expect(draft.body).not.toContain(WHEEL);
    expect(draft.body).toContain('You help a sim racing player');
    const sent = await a.invoke<Extract<Sent, { kind: 'draft' }>>('ai-assist:send', {
      requestId: draft.requestId,
    });
    expect(sent).toMatchObject({ kind: 'draft', items: 2, dropped: 2 });
    const view = await guideOf(a, CADILLAC);
    expect(view.guide).toMatchObject({ kind: 'drafted' });
    expect(view.guide!.sources[0]).toMatch(
      /from iRacing's action list\. Not checked by a person\./
    );
    expect(itemOf(view, 'item-1').actions[0]).toMatchObject({
      dcsName: 'Throttle',
      kind: 'axis',
      editable: false,
    });
    // iRacing's id gets the class guides' plain label.
    expect(itemOf(view, 'item-2').actions[0]).toMatchObject({
      dcsName: 'PitSpeedLimiter',
      label: 'Pit speed limiter',
      editable: true,
    });
    const list = await a.invoke<AircraftList>('ai-assist:aircraft', { game: 'iracing' });
    expect(list.aircraft.find((e) => e.id === CADILLAC)?.guide).toBe('drafted');
  });
});
