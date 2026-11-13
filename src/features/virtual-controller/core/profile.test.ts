import { afterEach, describe, expect, it } from 'vitest';
import { rigFromState, markFull, type TestRig } from '../../../../tests/helpers';
import { BUILTIN_PROFILES, copyName } from './builtins';
import { gameNoteCount } from './gameNotes';
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
    // Pitch inverted onto the gamepad stick. No split throttle: the game reads both
    // triggers held together, which one axis on both can never give. The throttle goes
    // on RT and a button on LT.
    expect(ace.sticks.ly.invert).toBe(true);
    expect(ace.throttle).toBeUndefined();
    expect(ace.triggers.rt.hint).toMatch(/throttle/i);
    expect(ace.triggers.lt.hint).toMatch(/button/i);
    expect(ace.triggers.rt.gameHint).toMatch(/high-G turn/);
    expect(ace.triggers.lt.gameHint).toMatch(/high-G turn/);
    const hotas = BUILTIN_PROFILES[1]!;
    expect(hotas.throttle?.split).toBe(0.5);
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
    // A second copy never shares the first one's name: it gets the next number.
    const again = await store.copy('starting-hotas', 'My HOTAS');
    expect(again.ok && again.value).toMatchObject({ id: 'my-hotas-2', name: 'My HOTAS 2' });

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

  it('only the starting point named for a game carries notes for a game', () => {
    const [ace, hotas, wheel] = BUILTIN_PROFILES;
    expect(ace!.game).toBe('Ace Combat 8');
    expect(ace!.name).toContain('Ace Combat 8');
    expect(gameNoteCount(ace!)).toBeGreaterThan(5);
    // Where the players' guides do not agree, the starting point claims nothing.
    for (const name of ['a', 'b', 'x', 'y'] as const) {
      expect(ace!.buttons[name]?.gameHint).toBeUndefined();
    }
    for (const plain of [hotas!, wheel!]) {
      expect(plain.game).toBeUndefined();
      expect(gameNoteCount(plain)).toBe(0);
      expect(`${plain.name} ${plain.description} ${JSON.stringify(plain)}`).not.toMatch(
        /ace combat/i
      );
    }
    // A plain hint never says what a part does in one game.
    const hints = JSON.stringify(ace, (key, value: unknown) =>
      key === 'gameHint' || key === 'description' || key === 'game' || key === 'name'
        ? undefined
        : value
    );
    expect(hints).not.toMatch(/lock on|weapon\b(?! release)|reticle|target|high-G|expert/i);
  });

  it('names a copy for what it was copied from', () => {
    expect(copyName(BUILTIN_PROFILES[0]!)).toBe('My Ace Combat 8 stick');
    expect(copyName(BUILTIN_PROFILES[1]!)).toBe('My HOTAS');
    expect(copyName(BUILTIN_PROFILES[2]!)).toBe('My wheel and pedals');
    expect(copyName({ id: 'my-hotas', name: 'My HOTAS' })).toBe('Copy of My HOTAS');
    expect(copyName({ id: 'long', name: 'x'.repeat(80) }).length).toBe(80);
  });

  it('never gives a new or renamed profile a name another profile has', async () => {
    rig = await rigFromState(await markFull());
    const store = new ProfileStore(rig.ports);
    const first = await store.copy('starting-hotas', 'My HOTAS');
    const second = await store.copy('starting-hotas', 'Space stick');
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    // A rename onto a name that is taken, however it is spaced or capitalised.
    const renamed = await store.save({ ...second.value, name: '  my  hotas ' });
    expect(renamed).toMatchObject({
      ok: false,
      error: {
        code: 'vc.nameTaken',
        message: 'Another profile is already called "My HOTAS". Give this one a different name.',
      },
    });
    // A starting point's name is taken too.
    const asStart = await store.save({ ...second.value, name: 'HOTAS to gamepad' });
    expect(asStart).toMatchObject({
      ok: false,
      error: {
        code: 'vc.nameTaken',
        message:
          'A starting point is already called "HOTAS to gamepad". Give this one a different name.',
      },
    });
    // A new profile under a taken name.
    const fresh = await store.save({ id: 'brand-new', name: 'My HOTAS' });
    expect(fresh).toMatchObject({ ok: false, error: { code: 'vc.nameTaken' } });
    // Nothing of that was written.
    const all = await store.all();
    expect(all.ok && all.value.mine.map((p) => [p.id, p.name])).toEqual([
      ['my-hotas', 'My HOTAS'],
      ['space-stick', 'Space stick'],
    ]);
    // A free name, and the profile's own name again, are saved.
    expect(await store.save({ ...second.value, name: 'Space stick 2' })).toMatchObject({
      ok: true,
      value: { id: 'space-stick', name: 'Space stick 2' },
    });
    expect(await store.save({ ...first.value, description: 'Changed' })).toMatchObject({
      ok: true,
      value: { name: 'My HOTAS', description: 'Changed' },
    });
  });

  it('two copies asked for at once get two names and two ids', async () => {
    rig = await rigFromState(await markFull());
    const store = new ProfileStore(rig.ports);
    const made = await Promise.all([
      store.copy('starting-hotas', 'My HOTAS'),
      store.copy('starting-hotas', 'My HOTAS'),
      store.copy('starting-hotas', 'My HOTAS'),
    ]);
    expect(made.every((m) => m.ok)).toBe(true);
    const all = await store.all();
    expect(all.ok && all.value.mine.map((p) => [p.id, p.name])).toEqual([
      ['my-hotas', 'My HOTAS'],
      ['my-hotas-2', 'My HOTAS 2'],
      ['my-hotas-3', 'My HOTAS 3'],
    ]);
  });

  it('profiles that already share a name still load, in a steady order, and can be edited', async () => {
    rig = await rigFromState(await markFull());
    const store = new ProfileStore(rig.ports);
    const twin = (id: string): unknown => ({ id, name: 'My flight stick to gamepad' });
    const seeded = await rig.ports.files.write(
      store.file,
      JSON.stringify({
        profiles: [twin('my-flight-stick-to-gamepad-2'), twin('my-flight-stick-to-gamepad')],
      }),
      { reason: 'Two profiles of one name, as made before names had to differ' }
    );
    expect(seeded.ok).toBe(true);
    const all = await store.all();
    expect(all.ok && all.value.mine.map((p) => p.id)).toEqual([
      'my-flight-stick-to-gamepad',
      'my-flight-stick-to-gamepad-2',
    ]);
    // Saved under the name it has: the name did not change, so it is not refused.
    const one = await store.get('my-flight-stick-to-gamepad-2');
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(await store.save({ ...one.value, description: 'The second one' })).toMatchObject({
      ok: true,
      value: { name: 'My flight stick to gamepad', description: 'The second one' },
    });
    // A third copy under that name gets a number of its own.
    const third = await store.copy('my-flight-stick-to-gamepad', 'My flight stick to gamepad');
    expect(third.ok && third.value).toMatchObject({
      id: 'my-flight-stick-to-gamepad-2-2',
      name: 'My flight stick to gamepad 2',
    });
  });

  it('a copy of the earlier Ace Combat 8 starting point shows its notes as notes for that game', async () => {
    rig = await rigFromState(await markFull());
    const store = new ProfileStore(rig.ports);
    const seeded = await rig.ports.files.write(
      store.file,
      JSON.stringify({
        profiles: [
          {
            id: 'old-copy',
            name: 'Old copy',
            buttons: {
              a: { hint: 'Fire the gun or missile, as set in the game' },
              b: { hint: 'Special weapon' },
              rs: { hint: 'Lock on (R3 in the Standard layout)' },
              start: { hint: 'Pause and the menu' },
            },
          },
        ],
      }),
      { reason: 'A profile from before notes for one game were kept apart' }
    );
    expect(seeded.ok).toBe(true);
    const got = await store.get('old-copy');
    expect(got.ok && got.value.game).toBe('Ace Combat 8');
    expect(got.ok && got.value.buttons.b).toEqual({ gameHint: 'Special weapon' });
    expect(got.ok && got.value.buttons.start).toEqual({ hint: 'Pause and the menu' });
  });

  it('makes ids from names that are never a starting point or one that is taken', () => {
    expect(freeId('ACE COMBAT 8 stick!', new Set())).toBe('ace-combat-8-stick');
    expect(freeId('Starting hotas', new Set())).toBe('hotas');
    expect(freeId('***', new Set())).toBe('controller');
    expect(freeId('a', new Set(['a', 'a-2']))).toBe('a-3');
  });
});
