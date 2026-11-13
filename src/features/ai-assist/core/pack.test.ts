import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BindingReader, BoundAction } from '../../../core/bindings';
import { actionLists } from '../../../../tests/dcsActionLists';
import { BINDING_FILES } from '../../../../tests/dcsBindings';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import {
  itemStatus,
  matchActions,
  MAX_PATTERN,
  MAX_PATTERNS,
  MAX_REPEATS,
  parsePack,
  resolvePack,
  shippedPacks,
  type Pack,
  type PackItem,
} from './pack';
import { shipped, shippedPack } from './shipped';

/**
 * The DCS input profiles with a shipped guide, in lower case: every installed aircraft with
 * a pilot's seat worth guiding (docs/manual/dcs/binding-guide-and-ai.md lists them).
 */
const SHIPPED = [
  'fa-18c_hornet',
  'uh-1h',
  'f-16c_50',
  'a-10c ii',
  'a-10c',
  'a-10a',
  'f-14',
  'f-14_rio',
  'f-15e',
  'f-15e_wso',
  'f-15c',
  'mig-29',
  'mig-29c',
  'mig-29g',
  'su-27',
  'j-11a',
  'su-33',
  'su-25t',
  'su-25',
  'ka-50',
  'ka-50 iii',
  'p-51d',
  'tf-51d',
  'f-86f sabre',
  'christen eagle ii',
];

let app: WiredApp;
let reader: BindingReader;
beforeAll(async () => {
  app = await wiredApp('dcs-bindings-hornet', { files: BINDING_FILES });
  reader = app.wiring.context.bindings.get('dcs')!;
});
afterAll(() => app?.cleanup());

const MINIMAL = `
format: 1
aircraft: { id: Test-1, name: Test }
summary: A test aircraft.
sources: [made up]
roles: { stick: { summary: Stick things., items: [pitch] } }
items:
  - id: pitch
    title: Pitch
    tier: must
    place: hotas
    role: stick
    what: Pitch.
    when: Always.
    actions: [{ name: Pitch, label: Pitch }]
`;

describe('binding guides (knowledge packs)', () => {
  it('ships a guide for every aircraft in the list, by its DCS input profile id', () => {
    // The iRacing class guides are keyed "iracing:<class>" (iracingGuides.test.ts).
    const dcs = [...shipped()].filter(([, p]) => p.game === 'dcs').map(([key]) => key);
    expect(dcs.sort()).toEqual([...SHIPPED].sort());
    expect(shippedPack('FA-18C_hornet')?.aircraft.name).toBe('F/A-18C Hornet');
    expect(shippedPack('uh-1h')?.aircraft.name).toBe('UH-1H Huey');
    expect(shippedPack('F-16C_50')?.aircraft.name).toBe('F-16C Viper');
    // A variant listed under `also` gets the same guide.
    expect(shippedPack('Ka-50 III')).toBe(shippedPack('Ka-50'));
    // Gunner seats and aircraft that are not installed have none.
    expect(shippedPack('UH-1H_Gunner')).toBeUndefined();
    expect(shippedPack('AH-64D_BLK_II')).toBeUndefined();
  });

  function missingNames(pack: Pack, actions: BoundAction[]): string[] {
    const missing: string[] = [];
    for (const item of pack.items) {
      for (const spec of item.actions) {
        const one: PackItem = { ...item, actions: [spec] };
        if (matchActions(one, actions).length === 0) {
          missing.push(`${item.id}: ${'name' in spec ? spec.name : spec.re}`);
        }
      }
    }
    return missing;
  }

  async function namesExist(id: string): Promise<void> {
    const actions = await reader.actions!(id);
    if (!actions.ok) throw new Error(actions.error.message);
    expect(missingNames(shippedPack(id)!, actions.value)).toEqual([]);
  }

  function complete(pack: Pack): void {
    const tiers = new Set(pack.items.map((i) => i.tier));
    expect([...tiers].sort()).toEqual(['must', 'nice', 'should']);
    expect(Object.keys(pack.roles)).toEqual(
      expect.arrayContaining(['stick', 'throttle', 'pedals'])
    );
    for (const item of pack.items) {
      expect(item.what.length).toBeGreaterThan(10);
      expect(item.when.length).toBeGreaterThan(5);
    }
    // Every item is somewhere in the per-device plan.
    const planned = new Set(Object.values(pack.roles).flatMap((r) => r?.items ?? []));
    expect(pack.items.filter((i) => !planned.has(i.id)).map((i) => i.id)).toEqual([]);
    // Each says where its knowledge comes from and that nobody from the aircraft checked it.
    expect(pack.sources.join(' ')).toContain('Not affiliated with or reviewed by Eagle Dynamics');
  }

  it("every action the FA-18C_hornet guide names exists in DCS's default input files", () =>
    namesExist('FA-18C_hornet'));
  it("every action the UH-1H guide names exists in DCS's default input files", () =>
    namesExist('UH-1H'));

  it('the recorded action lists are what the app reads from the install', async () => {
    for (const id of ['FA-18C_hornet', 'UH-1H']) {
      const actions = await reader.actions!(id);
      if (!actions.ok) throw new Error(actions.error.message);
      const recorded = actionLists().get(id.toLowerCase())!;
      expect(recorded.actions.map((a) => [a.name, a.kind])).toEqual(
        actions.value.map((a) => [a.name, a.kind])
      );
      // The same ids too, except the few whose engine number lives in a cockpit script the
      // recorded rig does not have (the Huey's search light): there the rig keeps the name.
      const ids = new Set(actions.value.map((a) => a.id));
      const differ = recorded.actions.filter((a) => !ids.has(a.id)).map((a) => a.name);
      expect(differ.length).toBeLessThanOrEqual(3);
    }
  });

  const packs = [...new Set(shipped().values())].filter((p) => p.game === 'dcs');
  it.each(packs.map((p) => [p.aircraft.id, p] as const))(
    "every action the %s guide names exists in DCS's input files for each profile it is for",
    (_id, pack) => {
      for (const id of [pack.aircraft.id, ...(pack.aircraft.also ?? [])]) {
        const list = actionLists().get(id.toLowerCase());
        expect(list, `no recorded action list for ${id}`).toBeDefined();
        expect(missingNames(pack, list!.actions), id).toEqual([]);
      }
    }
  );

  it.each(packs.map((p) => [p.aircraft.id, p] as const))(
    'the %s guide has every tier, a plan for the main devices, and explains each item',
    (_id, pack) => complete(pack)
  );

  it('refuses two shipped guides for the same aircraft', () => {
    const two = MINIMAL.replace(
      'aircraft: { id: Test-1, name: Test }',
      'aircraft: { id: Test-2, name: Test, also: [test-1] }'
    );
    expect(() => shippedPacks({ 'a.yaml': MINIMAL, 'b.yaml': two })).toThrow(/already for test-1/);
    expect([...shippedPacks({ 'b.yaml': two }).keys()]).toEqual(['test-2', 'test-1']);
  });

  it('shows what each item does and what it is bound to now, from the effective bindings', async () => {
    const pack = shippedPack('FA-18C_hornet')!;
    const actions = await reader.actions!('FA-18C_hornet');
    const bindings = await reader.bindings('FA-18C_hornet');
    if (!actions.ok || !bindings.ok) throw new Error('read failed');
    const items = resolvePack(pack, actions.value, bindings.value);
    const pitch = items.find((i) => i.item.id === 'pitch-roll')!;
    expect(pitch.status).toBe('bound');
    const bound = pitch.actions.find((a) => a.dcsName === 'Pitch')!.bound;
    // DCS's defaults also put pitch on the wheel base, which is marked as not used in DCS.
    expect(bound.find((b) => b.device.startsWith('FANATEC'))?.ignored).toBe(true);
    expect(bound.find((b) => !b.ignored)).toMatchObject({
      device: 'WINWING Orion Joystick Base 2 + JGRIP-F16',
      input: 'JOY_Y',
      inputLabel: 'Y axis',
      keyboard: false,
    });
    const scs = items.find((i) => i.item.id === 'sensor-control')!;
    expect(scs.actions.map((a) => a.label)).toContain('Sensor select: HUD');
    expect(scs.actions.find((a) => a.label === 'Sensor select: HUD')!.dcsName).toBe(
      'Sensor Control Switch - Fwd'
    );
    // A pattern item expands to every matching action, in DCS's order.
    expect(items.find((i) => i.item.id === 'left-ddi')!.actions).toHaveLength(20);
  });

  it('works out whether an item is bound where it belongs', () => {
    const item = (place: PackItem['place'], need: PackItem['need']): PackItem =>
      parsePack(MINIMAL).ok
        ? {
            ...(parsePack(MINIMAL) as { ok: true; value: { items: PackItem[] } }).value.items[0]!,
            place,
            need,
          }
        : (undefined as never);
    const onKeyboard = {
      device: 'Keyboard',
      keyboard: true,
      input: 'G',
      inputLabel: 'G',
      modifiers: [],
      source: 'default' as const,
    };
    const onStick = { ...onKeyboard, device: 'Stick', keyboard: false };
    const action = (bound: (typeof onKeyboard)[]) => ({
      actionId: 'a',
      dcsName: 'A',
      label: 'A',
      kind: 'button' as const,
      editable: true,
      bound,
    });
    expect(itemStatus(item('hotas', 'all'), [])).toBe('missing');
    expect(itemStatus(item('hotas', 'all'), [action([onKeyboard])])).toBe('unbound');
    expect(itemStatus(item('keyboard', 'all'), [action([onKeyboard])])).toBe('bound');
    expect(itemStatus(item('hotas', 'all'), [action([onStick]), action([])])).toBe('partial');
    expect(itemStatus(item('hotas', 'any'), [action([onStick]), action([])])).toBe('bound');
  });

  it('refuses a pack file that does not fit the format, saying what is wrong', () => {
    expect(parsePack(MINIMAL).ok).toBe(true);
    const bad = parsePack(MINIMAL.replace('tier: must', 'tier: urgent'), 'x.yaml');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.message).toContain('x.yaml');
      expect(bad.error.detail).toContain('tier');
    }
    expect(parsePack('{ not yaml').ok).toBe(false);
    const unknownItem = parsePack(MINIMAL.replace('items: [pitch]', 'items: [pitch, yaw]'));
    expect(!unknownItem.ok && unknownItem.error.detail).toContain('unknown item yaw');
    const badPattern = parsePack(
      MINIMAL.replace('[{ name: Pitch, label: Pitch }]', "[{ re: '(' }]")
    );
    expect(!badPattern.ok && badPattern.error.detail).toContain('bad pattern');
    const extraField = parsePack(
      MINIMAL.replace('when: Always.', 'when: Always.\n    run: rm -rf')
    );
    expect(extraField.ok).toBe(false);
  });

  it('AI-009 keeps every pattern quick to run: short, no group that repeats, few repeats, few patterns', () => {
    const withPatterns = (...patterns: string[]) =>
      parsePack(
        MINIMAL.replace(
          '[{ name: Pitch, label: Pitch }]',
          `[${patterns.map((re) => `{ re: ${JSON.stringify(re)} }`).join(', ')}]`
        )
      );
    const said = (result: ReturnType<typeof parsePack>): string =>
      result.ok ? 'taken' : (result.error.detail ?? '');

    expect(MAX_PATTERN).toBe(100);
    expect(said(withPatterns(`^P${'.'.repeat(MAX_PATTERN - 2)}`))).toBe('taken');
    expect(said(withPatterns(`^P${'.'.repeat(MAX_PATTERN - 1)}`))).toMatch(/100/);
    // A group that repeats, in each way it can be written.
    for (const re of ['(a+)+$', '(a|aa)*b', '(?:Pitch ?){1,9}']) {
      expect(said(withPatterns(re))).toContain('item pitch: a pattern may not repeat a group');
    }
    // An escaped bracket or sign is a character like any other.
    expect(said(withPatterns('^Trim \\(Up\\)\\+$'))).toBe('taken');
    // A group that is optional, or followed by something else that repeats, does not repeat.
    expect(said(withPatterns('^(Pitch)? +Up$'))).toBe('taken');
    expect(said(withPatterns('^Pitch .*$', '^P.+ch$'))).toBe('taken');
    expect(said(withPatterns('^.*P.*i.*tch$'))).toContain(
      `item pitch: a pattern may use *, + or {…} at most ${MAX_REPEATS} times`
    );
    const many = Array.from({ length: MAX_PATTERNS }, (_, n) => `^Pitch ${n}$`);
    expect(said(withPatterns(...many))).toBe('taken');
    // The count is of the whole guide, across its items.
    const second = `
  - id: roll
    title: Roll
    tier: must
    place: hotas
    role: stick
    what: Roll.
    when: Always.
    actions: [{ re: '^Roll$' }]
`;
    const overTheCount = parsePack(
      MINIMAL.replace(
        '[{ name: Pitch, label: Pitch }]',
        `[${many.map((re) => `{ re: ${JSON.stringify(re)} }`).join(', ')}]`
      ) + second.trimStart().replace(/^/, '  ')
    );
    expect(said(overTheCount)).toContain(
      `a guide may hold at most ${MAX_PATTERNS} patterns (this one has ${MAX_PATTERNS + 1})`
    );
    // The guides RigReady ships stay well inside all of it.
    for (const pack of new Set(shipped().values())) {
      const patterns = pack.items
        .flatMap((i) => i.actions)
        .flatMap((s) => ('re' in s ? [s.re] : []));
      expect(patterns.length, pack.aircraft.id).toBeLessThanOrEqual(10);
      for (const re of patterns) expect(re.length, re).toBeLessThanOrEqual(70);
    }
  });
});
