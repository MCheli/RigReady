import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fixturesDir, wiredApp, type WiredApp } from '../../../../tests/helpers';
import { classGuides, classInName, IRACING_CLASSES } from './iracing';
import { itemStatus, packText, parsePack, type Pack, type ResolvedAction } from './pack';
import { shipped, shippedPack } from './shipped';

/**
 * The iRacing binding guides: one per class of car, every action named by iRacing's own id.
 * iRacing's list of actions is recorded in fixtures/iracing-actions (the 369 actions of the
 * owner's control profile "Baseline", 13 Nov 2026), and that list is held to what RigReady
 * reads from the scenario's copy of the same file.
 */

/** iRacing's actions as recorded: id -> what it can be bound to. */
function recordedActions(): Map<string, string[]> {
  const text = readFileSync(
    path.join(fixturesDir, 'iracing-actions', 'baseline-2026-11.txt'),
    'utf8'
  );
  const actions = new Map<string, string[]>();
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const [id, accepts] = line.trim().split(' ');
    actions.set(id!, accepts!.split(','));
  }
  return actions;
}

const ACTIONS = recordedActions();
const guides = classGuides(shipped().values());
const named = (pack: Pack): { item: string; name: string }[] =>
  pack.items.flatMap((item) =>
    item.actions.flatMap((spec) => ('name' in spec ? [{ item: item.id, name: spec.name }] : []))
  );

let app: WiredApp | undefined;
afterAll(() => app?.cleanup());

describe('iRacing binding guides', () => {
  it('ships one guide per class: GT3, GT4, LMDh and prototypes, formula, oval and dirt', () => {
    expect(guides.map((p) => p.aircraft.id)).toEqual([...IRACING_CLASSES]);
    expect(guides.map((p) => p.aircraft.name)).toEqual([
      'GT3',
      'GT4',
      'LMDh and prototypes',
      'Formula and open-wheel',
      'Oval',
      'Dirt',
    ]);
    for (const pack of guides) {
      expect(pack.game).toBe('iracing');
      expect(shippedPack(`iracing:${pack.aircraft.id}`)).toBe(pack);
    }
    // A DCS id never finds an iRacing guide, and the other way round.
    expect(shippedPack('gt3')).toBeUndefined();
    expect(shippedPack('iracing:FA-18C_hornet')).toBeUndefined();
  });

  it('the recorded list is the 369 actions RigReady reads from the control profile', async () => {
    expect(ACTIONS.size).toBe(369);
    app = await wiredApp('iracing-bindings-profiles', { files: ['Documents/iRacing/**'] });
    const set = await app.invoke<{ actions: { id: string; accepts: string[] }[] }>(
      'iracing-bindings:set',
      { id: 'all' }
    );
    expect(set.actions.map((a) => [a.id, a.accepts])).toEqual([...ACTIONS.entries()]);
  });

  it.each(guides.map((p) => [p.aircraft.id, p] as const))(
    "every action the %s guide names is in iRacing's list of actions",
    (_id, pack) => {
      const missing = named(pack).filter((n) => !ACTIONS.has(n.name));
      expect(missing).toEqual([]);
      // Ids only: a pattern would match names RigReady cannot check here.
      expect(pack.items.flatMap((i) => i.actions).every((spec) => 'name' in spec)).toBe(true);
    }
  );

  it.each(guides.map((p) => [p.aircraft.id, p] as const))(
    'the %s guide puts each item where iRacing can bind it: an axis item on actions that take an axis, any other on actions that take a button or a key',
    (_id, pack) => {
      for (const item of pack.items) {
        for (const spec of item.actions) {
          if (!('name' in spec)) continue;
          const accepts = ACTIONS.get(spec.name) ?? [];
          if (item.input === 'axis') expect(accepts, spec.name).toContain('axis');
          else
            expect(
              accepts.some((k) => k === 'button' || k === 'key'),
              spec.name
            ).toBe(true);
        }
      }
    }
  );

  it.each(guides.map((p) => [p.aircraft.id, p] as const))(
    'the %s guide has every tier, a plan for the wheel and the pedals, explains each item and says it was not reviewed by a racing driver',
    (_id, pack) => {
      expect([...new Set(pack.items.map((i) => i.tier))].sort()).toEqual([
        'must',
        'nice',
        'should',
      ]);
      expect(Object.keys(pack.roles)).toEqual(expect.arrayContaining(['wheel', 'pedals']));
      for (const item of pack.items) {
        expect(item.what.length).toBeGreaterThan(10);
        expect(item.when.length).toBeGreaterThan(5);
        expect(['rim', 'panel', 'keyboard']).toContain(item.place);
      }
      const planned = new Set(Object.values(pack.roles).flatMap((r) => r?.items ?? []));
      expect(pack.items.filter((i) => !planned.has(i.id)).map((i) => i.id)).toEqual([]);
      const sources = pack.sources.join(' ');
      expect(sources).toContain('Not reviewed by a racing driver');
      expect(sources).toContain('Not affiliated with or reviewed by iRacing');
      // The steering and the pedals are must-haves, and are bound in iRacing.
      for (const id of ['steering', 'throttle', 'brake']) {
        const item = pack.items.find((i) => i.id === id)!;
        expect(item.tier, id).toBe('must');
        expect(item.input, id).toBe('axis');
      }
    }
  );

  it('the formula guide has DRS and push to pass, where iRacing has them', () => {
    const formula = shippedPack('iracing:formula')!;
    const names = named(formula).map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(['DRS', 'PushToPass']));
    expect(formula.items.find((i) => i.id === 'drs')!.place).toBe('rim');
    expect(formula.items.find((i) => i.id === 'push-to-pass')!.place).toBe('rim');
  });

  it('gives one action the same plain label in every guide, so the class shown changes no name', () => {
    const labels = new Map<string, Set<string>>();
    for (const pack of guides) {
      for (const item of pack.items) {
        for (const spec of item.actions) {
          if (!('name' in spec)) continue;
          labels.set(spec.name, (labels.get(spec.name) ?? new Set()).add(spec.label));
        }
      }
    }
    const twice = [...labels].filter(([, set]) => set.size > 1).map(([name]) => name);
    expect(twice).toEqual([]);
  });

  it('suggests a class only from what a car folder name says', () => {
    expect(classInName('porsche992rgt3')).toEqual({ classId: 'gt3', token: 'gt3' });
    expect(classInName('bmwm4gt4')).toEqual({ classId: 'gt4', token: 'gt4' });
    expect(classInName('cadillacvseriesrgtp')).toEqual({ classId: 'prototypes', token: 'gtp' });
    expect(classInName('dirtlatemodel')).toEqual({ classId: 'dirt', token: 'dirt' });
    // Nothing in the name: no guess.
    expect(classInName('cadillacctsvr')).toBeUndefined();
    expect(classInName('mx5 mx52016')).toBeUndefined();
    expect(classInName('dallarair18')).toBeUndefined();
  });
});

describe('the guide format for iRacing', () => {
  const MINIMAL = `
format: 1
game: iracing
car: { id: "car:my car", name: My car }
summary: A test car.
sources: [made up]
roles: { wheel: { summary: Rim things., items: [limiter] }, pedals: { summary: Pedals., items: [throttle] } }
items:
  - id: limiter
    title: Pit limiter
    tier: must
    place: rim
    role: wheel
    what: The pit speed limiter.
    when: In the pits.
    actions: [{ name: PitSpeedLimiter, label: Pit speed limiter on or off }]
  - id: throttle
    title: Throttle
    tier: must
    place: rim
    role: pedals
    input: axis
    what: The throttle pedal.
    when: Always.
    actions: [{ name: Throttle, label: Throttle }]
`;

  it('reads `car` as what the guide is for, and writes it back as `car`', () => {
    const parsed = parsePack(MINIMAL);
    if (!parsed.ok) throw new Error(parsed.error.detail);
    expect(parsed.value.game).toBe('iracing');
    expect(parsed.value.aircraft).toEqual({ id: 'car:my car', name: 'My car' });
    const text = packText(parsed.value);
    expect(text).toMatch(/^format: 1\ngame: iracing\ncar:\n/);
    expect(text).not.toContain('aircraft:');
    const again = parsePack(text);
    expect(again.ok && again.value).toEqual(parsed.value);
  });

  it('a DCS guide is written as before: no game line, `aircraft`', () => {
    const text = packText(shippedPack('FA-18C_hornet')!);
    expect(text).toMatch(/^format: 1\naircraft:\n/);
    expect(text).not.toMatch(/^game:/m);
  });

  it("refuses the other game's places and roles, and `input` in a DCS guide", () => {
    const problems = (source: string): string => {
      const parsed = parsePack(source);
      return parsed.ok ? 'ok' : (parsed.error.detail ?? '');
    };
    expect(
      problems(MINIMAL.replace('place: rim\n    role: wheel', 'place: hotas\n    role: stick'))
    ).toMatch(
      /place hotas is not one of rim, panel, keyboard[\s\S]*role stick is not one of wheel/
    );
    expect(problems(MINIMAL.replace('wheel: { summary', 'stick: { summary'))).toMatch(
      /roles.stick is not one of/
    );
    const dcs = MINIMAL.replace('game: iracing\n', '')
      .replace('car: {', 'aircraft: {')
      .replaceAll('place: rim', 'place: hotas')
      .replace('role: wheel', 'role: stick')
      .replace('role: pedals', 'role: throttle')
      .replace('wheel: { summary', 'stick: { summary')
      .replace('pedals: { summary', 'throttle: { summary');
    expect(problems(dcs)).toMatch(/input is for iRacing guides/);
    expect(problems(dcs.replace('    input: axis\n', ''))).toBe('ok');
  });

  it("an iRacing item that RigReady cannot bind is to be bound in iRacing; DCS keeps 'not bound'", () => {
    const pack = parsePack(MINIMAL);
    if (!pack.ok) throw new Error('bad');
    const throttle = pack.value.items[1]!;
    const unbound: ResolvedAction = {
      actionId: 'Throttle',
      dcsName: 'Throttle',
      label: 'Throttle',
      kind: 'axis',
      editable: false,
      bound: [],
    };
    expect(itemStatus(throttle, [unbound], 'iracing')).toBe('inGame');
    expect(itemStatus(throttle, [unbound], 'dcs')).toBe('unbound');
    // A button RigReady can bind is not bound yet, not "bind in iRacing".
    expect(itemStatus(throttle, [{ ...unbound, kind: 'button', editable: true }], 'iracing')).toBe(
      'unbound'
    );
    // Bound on an axis in iRacing's file: bound, whoever bound it.
    const onAxis = {
      device: 'Pedals',
      keyboard: false,
      input: 'Accelerator',
      inputLabel: 'Accelerator',
      modifiers: [],
      source: 'user' as const,
      kind: 'axis' as const,
    };
    expect(itemStatus(throttle, [{ ...unbound, bound: [onAxis] }], 'iracing')).toBe('bound');
    // A throttle on a wheel button is not a throttle pedal set up: still to bind in iRacing.
    const onButton = {
      ...onAxis,
      input: 'Button 3',
      inputLabel: 'Button 3',
      kind: 'button' as const,
    };
    expect(itemStatus(throttle, [{ ...unbound, bound: [onButton] }], 'iracing')).toBe('inGame');
  });
});
