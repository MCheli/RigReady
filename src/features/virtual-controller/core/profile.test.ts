import { afterEach, describe, expect, it } from 'vitest';
import { rigFromState, markFull, type TestRig } from '../../../../tests/helpers';
import { BUILTIN_PROFILES } from './builtins';
import { INPUT_PATTERN, PadProfileSchema, profileSources, inputLabel } from './profile';
import { freeId, ProfileStore } from './store';

let rig: TestRig | undefined;
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
});

describe('virtual controller profiles', () => {
  it('a profile with nothing but an id and a name is a complete, unmapped Xbox 360 profile', () => {
    const profile = PadProfileSchema.parse({ id: 'x', name: 'X' });
    expect(profile.kind).toBe('xbox360');
    expect(profile.sticks.lx).toEqual({ invert: false, deadzone: 0, curve: 1, range: 1 });
    expect(profile.triggers.rt.curve).toBe(1);
    expect(profile.throttle).toBeUndefined();
    expect(profileSources(profile)).toEqual([]);
  });

  it('refuses inputs DirectInput does not have, values out of range and unsafe ids', () => {
    for (const ok of ['JOY_X', 'JOY_SLIDER2', 'JOY_BTN1', 'JOY_BTN128', 'JOY_BTN_POV4_UL']) {
      expect(INPUT_PATTERN.test(ok)).toBe(true);
    }
    for (const bad of ['JOY_BTN0', 'JOY_BTN129', 'JOY_W', 'JOY_BTN_POV5_U', 'X', 'JOY_X; rm']) {
      expect(INPUT_PATTERN.test(bad)).toBe(false);
    }
    const base = { id: 'x', name: 'X' };
    expect(PadProfileSchema.safeParse({ ...base, id: '../x' }).success).toBe(false);
    expect(
      PadProfileSchema.safeParse({ ...base, sticks: { lx: { deadzone: 0.95 } } }).success
    ).toBe(false);
    expect(PadProfileSchema.safeParse({ ...base, sticks: { lx: { curve: 0 } } }).success).toBe(
      false
    );
    expect(PadProfileSchema.safeParse({ ...base, throttle: { split: 1 } }).success).toBe(false);
    expect(PadProfileSchema.safeParse({ ...base, buttons: { z: {} } }).success).toBe(false);
    expect(PadProfileSchema.safeParse({ ...base, kind: 'switch' }).success).toBe(false);
  });

  it('the starting points are valid, map nothing yet and say what each part is for', () => {
    expect(BUILTIN_PROFILES.map((p) => p.id)).toEqual([
      'starting-flight-stick-ace-combat',
      'starting-hotas',
      'starting-wheel-pedals',
    ]);
    for (const p of BUILTIN_PROFILES) {
      expect(profileSources(p)).toEqual([]);
      expect(p.description).toMatch(/starting point/i);
      expect(p.sticks.lx.hint).toBeTruthy();
    }
    const ace = BUILTIN_PROFILES[0]!;
    // Pitch inverted onto the gamepad stick; the throttle split over both triggers.
    expect(ace.sticks.ly.invert).toBe(true);
    expect(ace.throttle?.split).toBe(0.5);
    const wheel = BUILTIN_PROFILES[2]!;
    expect(wheel.sticks.lx.range).toBe(0.3);
    expect(wheel.throttle).toBeUndefined();
    expect(wheel.triggers.rt.hint).toMatch(/throttle/i);
  });

  it('labels inputs in words', () => {
    expect(inputLabel('JOY_RZ')).toBe('Z rotation');
    expect(inputLabel('JOY_BTN5')).toBe('Button 5');
    expect(inputLabel('JOY_BTN_POV1_UL')).toBe('Hat 1 up-left');
    expect(inputLabel('JOY_Y', 'above')).toMatch(/past half/);
  });

  it('stores the user own profiles, copies starting points, never changes or deletes one', async () => {
    rig = await rigFromState(await markFull());
    const store = new ProfileStore(rig.ports);
    expect((await store.all()).ok && (await store.all())).toMatchObject({ value: { mine: [] } });

    const copied = await store.copy('starting-hotas', 'My HOTAS');
    expect(copied.ok && copied.value.id).toBe('my-hotas');
    const again = await store.copy('starting-hotas', 'My HOTAS');
    expect(again.ok && again.value.id).toBe('my-hotas-2');

    const refused = await store.save({ ...BUILTIN_PROFILES[1]!, name: 'Changed' });
    expect(refused).toMatchObject({ ok: false, error: { code: 'vc.builtin' } });
    expect(await store.remove('starting-hotas')).toMatchObject({ ok: false });

    const mine = await store.get('my-hotas');
    expect(mine.ok && mine.value.name).toBe('My HOTAS');
    expect(await store.remove('my-hotas')).toEqual({ ok: true, value: true });
    expect(await store.remove('my-hotas')).toEqual({ ok: true, value: false });
    expect(await store.get('my-hotas')).toMatchObject({
      ok: false,
      error: { code: 'vc.unknownProfile' },
    });
    // Kept in RigReady's own folder: nothing journaled, nothing outside it written.
    expect(store.file.startsWith(rig.ports.folders.dataRoot())).toBe(true);
    const journal = await rig.ports.files.journal();
    expect(journal.ok && journal.value).toEqual([]);
  });

  it('makes ids from names that are never a starting point or one that is taken', () => {
    expect(freeId('ACE COMBAT 8 stick!', new Set())).toBe('ace-combat-8-stick');
    expect(freeId('Starting hotas', new Set())).toBe('hotas');
    expect(freeId('***', new Set())).toBe('controller');
    expect(freeId('a', new Set(['a', 'a-2']))).toBe('a-3');
  });
});
