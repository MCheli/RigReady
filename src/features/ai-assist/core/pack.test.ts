import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BindingReader } from '../../../core/bindings';
import { BINDING_FILES } from '../../../../tests/dcsBindings';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { itemStatus, matchActions, parsePack, resolvePack, type PackItem } from './pack';
import { shipped, shippedPack } from './shipped';

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
  it('ships a guide for the F/A-18C and the UH-1H', () => {
    expect([...shipped().keys()].sort()).toEqual(['fa-18c_hornet', 'uh-1h']);
    expect(shippedPack('FA-18C_hornet')?.aircraft.name).toBe('F/A-18C Hornet');
    expect(shippedPack('uh-1h')?.aircraft.name).toBe('UH-1H Huey');
    expect(shippedPack('F-16C_50')).toBeUndefined();
  });

  async function namesExist(id: string): Promise<void> {
    const pack = shippedPack(id)!;
    const actions = await reader.actions!(id);
    if (!actions.ok) throw new Error(actions.error.message);
    const missing: string[] = [];
    for (const item of pack.items) {
      for (const spec of item.actions) {
        const one: PackItem = { ...item, actions: [spec] };
        if (matchActions(one, actions.value).length === 0) {
          missing.push(`${item.id}: ${'name' in spec ? spec.name : spec.re}`);
        }
      }
    }
    expect(missing).toEqual([]);
  }

  function complete(id: string): void {
    const pack = shippedPack(id)!;
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
  }

  it("every action the FA-18C_hornet guide names exists in DCS's default input files", () =>
    namesExist('FA-18C_hornet'));
  it("every action the UH-1H guide names exists in DCS's default input files", () =>
    namesExist('UH-1H'));
  it('both guides have every tier, a plan for the main devices, and explain each item', () => {
    complete('FA-18C_hornet');
    complete('UH-1H');
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
});
