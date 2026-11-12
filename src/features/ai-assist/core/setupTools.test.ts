import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { ProfileSchema } from '../../../core/profile/schema';
import {
  detailOf,
  matchSetup,
  setupRead,
  setupTypes,
  type KnownTypes,
  type SetupRead,
  type SetupTypes,
} from './setupTools';

/**
 * The two reading tools that answer narrowly: one setup in a line per item, and the check
 * and fix types in a line each. An assistant pays for every character a tool answers, again
 * with every later request, so what these answer is measured here against the channels
 * they stand in for.
 */

const SETUPS = [
  { id: 'dcs-f-a-18c', name: 'DCS F/A-18C' },
  { id: 'dcs-f-16c', name: 'DCS F-16C' },
  { id: 'iracing', name: 'iRacing' },
];

describe('which setup an assistant means', () => {
  it('takes the id, the whole name, or a part of the name only one setup has', () => {
    expect(matchSetup('dcs-f-a-18c', SETUPS)).toMatchObject({ ok: true, value: SETUPS[0] });
    expect(matchSetup('  dcs f/a-18c ', SETUPS)).toMatchObject({ ok: true, value: SETUPS[0] });
    expect(matchSetup('FA-18C', SETUPS)).toMatchObject({ ok: true, value: SETUPS[0] });
    expect(matchSetup('the F-16C', SETUPS).ok).toBe(false);
    expect(matchSetup('f16', SETUPS)).toMatchObject({ ok: true, value: SETUPS[1] });
    expect(matchSetup('iRacing setup', SETUPS)).toMatchObject({ ok: true, value: SETUPS[2] });
  });

  it('never guesses between two: it names them, and names all when none fits', () => {
    const two = matchSetup('DCS', SETUPS);
    expect(two).toMatchObject({ ok: false, error: { code: 'ai.setup' } });
    if (two.ok) throw new Error('expected a refusal');
    expect(two.error.message).toBe('More than one setup fits "DCS".');
    expect(two.error.detail).toBe(
      'They are: DCS F/A-18C (dcs-f-a-18c), DCS F-16C (dcs-f-16c). Ask again with one id.'
    );
    const none = matchSetup('MSFS', SETUPS);
    if (none.ok) throw new Error('expected a refusal');
    expect(none.error.message).toBe('There is no setup "MSFS".');
    expect(none.error.detail).toContain('iRacing (iracing)');
    // One letter fits nearly everything, so it fits nothing.
    expect(matchSetup('c', SETUPS).ok).toBe(false);
    const empty = matchSetup('anything', []);
    if (empty.ok) throw new Error('expected a refusal');
    expect(empty.error.detail).toBe('Setups: none.');
  });
});

describe('one setup in a line per item', () => {
  const profile = ProfileSchema.parse({
    id: 'dcs-f-a-18c',
    name: 'DCS F/A-18C',
    description: 'Hornet, VR off.',
    game: 'dcs',
    createdAt: '2026-10-03T12:00:00.000Z',
    updatedAt: '2026-10-03T12:00:00.000Z',
    launch: { exe: '{DCS_INSTALL}/bin/DCS.exe', args: ['--force_disable_VR'] },
    checks: [
      {
        id: 'trackir',
        type: 'process.running',
        title: 'TrackIR is running',
        params: { name: 'TrackIR5.exe' },
        remediation: {
          type: 'process.launch',
          params: { exe: 'C:/Program Files (x86)/TrackIR5/TrackIR5.exe' },
        },
      },
      {
        id: 'srs',
        type: 'process.running',
        title: 'SRS is running',
        required: false,
        disabled: true,
        params: { name: 'SR-ClientRadio.exe' },
        remediation: { type: 'process.launch' },
      },
      { id: 'hmd', type: 'vr.headset', title: 'No headset needed' },
    ],
    actions: {
      preLaunch: [
        {
          id: 'sap',
          title: 'Start SimAppPro',
          type: 'process.launch',
          params: { exe: 'C:/SimAppPro/SimAppPro.exe', args: ['--minimized'] },
        },
      ],
      standDown: [{ id: 'audio', title: 'Speakers again', type: 'audio.default', params: {} }],
    },
  });

  it('says what Launch starts, each check with its fix, and each step with its phase', () => {
    const read = setupRead(profile, false);
    expect(read).toEqual({
      id: 'dcs-f-a-18c',
      name: 'DCS F/A-18C',
      game: 'dcs',
      description: 'Hornet, VR off.',
      launches: '{DCS_INSTALL}/bin/DCS.exe --force_disable_VR',
      checks: [
        {
          id: 'trackir',
          title: 'TrackIR is running',
          type: 'process.running',
          required: true,
          about: 'TrackIR5.exe',
          fix: 'process.launch: C:/Program Files (x86)/TrackIR5/TrackIR5.exe',
        },
        {
          id: 'srs',
          title: 'SRS is running',
          type: 'process.running',
          required: false,
          off: true,
          about: 'SR-ClientRadio.exe',
          fix: 'process.launch',
        },
        { id: 'hmd', title: 'No headset needed', type: 'vr.headset', required: true },
      ],
      steps: [
        {
          phase: 'preLaunch',
          id: 'sap',
          title: 'Start SimAppPro',
          type: 'process.launch',
          about: 'C:/SimAppPro/SimAppPro.exe --minimized',
        },
        { phase: 'standDown', id: 'audio', title: 'Speakers again', type: 'audio.default' },
      ],
    });
  });

  it('adds the params in full only when asked', () => {
    const read = setupRead(profile, true);
    expect(read.checks[0]).toMatchObject({
      params: { name: 'TrackIR5.exe' },
      fixParams: { exe: 'C:/Program Files (x86)/TrackIR5/TrackIR5.exe' },
    });
    expect(read.checks[2]).toMatchObject({ params: {} });
    expect(read.checks[2]).not.toHaveProperty('fixParams');
    expect(read.steps[0]).toMatchObject({ params: { args: ['--minimized'] } });
  });

  it('names a Steam game by its app, and a setup that starts nothing by nothing', () => {
    const steam = setupRead({ ...profile, launch: undefined, steamAppId: '266410' }, false);
    expect(steam.launches).toBe('Steam app 266410');
    const other = setupRead(
      { ...profile, launch: undefined, game: 'other', gameName: 'Falcon BMS', actions: undefined },
      false
    );
    expect(other).not.toHaveProperty('launches');
    expect(other.game).toBe('Falcon BMS');
    expect(other.steps).toEqual([]);
  });

  it('shows what params are about, or their start when nothing in them is a name', () => {
    expect(detailOf({ exe: 'a.exe', args: ['-x', '1'] })).toBe('a.exe -x 1');
    expect(detailOf({ device: 'Speakers' })).toBe('Speakers');
    expect(detailOf({ seconds: 5 })).toBe('{"seconds":5}');
    expect(detailOf({ text: 'y'.repeat(400) }).length).toBe(160);
  });
});

describe('the check and fix types, in a line each', () => {
  const known: KnownTypes = {
    checks: [
      {
        type: 'process.running',
        label: 'A program is running',
        group: 'software',
        schema: { type: 'object', properties: { name: { type: 'string' } } },
        fixes: ['process.launch'],
      },
      {
        type: 'note',
        label: 'A reminder',
        group: 'other',
        schema: { type: 'object' },
        advisory: true,
      },
    ],
    remediations: [
      {
        type: 'process.launch',
        label: 'Start a program',
        kind: 'program',
        schema: { type: 'object', properties: { exe: { type: 'string' } } },
        confirms: true,
      },
      { type: 'audio.default', label: 'Set the audio device', kind: 'setting', schema: {} },
    ],
  };

  it('lists every type without params, and gives the params only of the types asked for', () => {
    const all = setupTypes(known, undefined);
    if (!all.ok) throw new Error(all.error.message);
    expect(all.value).toEqual({
      checks: [
        {
          type: 'process.running',
          label: 'A program is running',
          group: 'software',
          fixes: ['process.launch'],
        },
        { type: 'note', label: 'A reminder', group: 'other', advisory: true },
      ],
      fixes: [
        { type: 'process.launch', label: 'Start a program', kind: 'program', confirms: true },
        { type: 'audio.default', label: 'Set the audio device', kind: 'setting' },
      ],
    });
    expect(setupTypes(known, [])).toEqual(all);

    const two = setupTypes(known, ['process.running', 'process.launch', 'nope']);
    if (!two.ok) throw new Error(two.error.message);
    expect(two.value.checks).toEqual([
      {
        type: 'process.running',
        label: 'A program is running',
        group: 'software',
        fixes: ['process.launch'],
        params: { type: 'object', properties: { name: { type: 'string' } } },
      },
    ]);
    expect(two.value.fixes.map((f) => f.type)).toEqual(['process.launch']);
    expect(two.value.fixes[0]!.params).toEqual(known.remediations[0]!.schema);
    expect(two.value.notFound).toEqual(['nope']);
  });

  it('refuses when none of the types asked for exists, and lists the ones that do', () => {
    const none = setupTypes(known, ['proces.runing']);
    if (none.ok) throw new Error('expected a refusal');
    expect(none.error.code).toBe('ai.type');
    expect(none.error.message).toBe('There is no check or fix type "proces.runing".');
    expect(none.error.detail).toBe(
      'Check types: process.running, note. Fix types: process.launch, audio.default.'
    );
  });
});

describe('the tools on the wired app, against the channels they stand in for', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    if (app) {
      for (const feature of app.wiring.features) await feature.dispose?.();
      await app.cleanup();
      app = undefined;
    }
  });

  const caller = () => ({
    id: 'builtin-assistant',
    name: 'Built-in assistant',
    signal: new AbortController().signal,
  });
  const size = (value: unknown): number => JSON.stringify(value).length;

  it('setup_read answers one setup in a fraction of what the whole list takes, and asks nobody', async () => {
    app = await wiredApp('flying-all-good');
    const host = app.wiring.context.mcp.host()!;
    const state = await app.invoke<{ profiles: { id: string; name: string }[] }>('fly:state');
    const setup = state.profiles[0]!;
    const seen = app.events.length;

    const read = await host.call(caller(), 'setup_read', { setup: setup.name });
    if (!read.ok) throw new Error(read.error.message);
    const value = read.value as SetupRead;
    expect(value).toMatchObject({ id: setup.id, name: setup.name });
    expect(value.checks.length).toBeGreaterThan(0);
    expect(value.checks[0]).not.toHaveProperty('params');
    expect(read.made).toMatchObject({ tier: 'read' });
    // A read: nothing was asked in the window.
    expect(app.events.slice(seen).some((e) => e.channel === 'mcp:event:confirm')).toBe(false);

    const whole = await host.call(caller(), 'rigready_call', { channel: 'profiles:list' });
    if (!whole.ok) throw new Error(whole.error.message);
    expect(size(value)).toBeLessThan(size(whole.value) / 2);

    // The same setup with everything, when a value is needed.
    const full = await host.call(caller(), 'setup_read', { setup: setup.id, params: true });
    if (!full.ok) throw new Error(full.error.message);
    expect((full.value as SetupRead).checks[0]).toHaveProperty('params');

    const missing = await host.call(caller(), 'setup_read', { setup: 'no such setup' });
    expect(missing).toMatchObject({ ok: false, error: { code: 'ai.setup' } });
  });

  it('setup_types lists the types in a tenth of what their schemas take, and one type on request', async () => {
    app = await wiredApp('flying-all-good');
    const host = app.wiring.context.mcp.host()!;
    const listed = await host.call(caller(), 'setup_types', {});
    if (!listed.ok) throw new Error(listed.error.message);
    const types = listed.value as SetupTypes;
    expect(types.checks.map((c) => c.type)).toContain('process.running');
    expect(types.fixes.map((f) => f.type)).toContain('process.launch');
    expect(types.checks.every((c) => c.params === undefined)).toBe(true);

    const whole = await host.call(caller(), 'rigready_call', { channel: 'profiles:types' });
    if (!whole.ok) throw new Error(whole.error.message);
    expect(size(types)).toBeLessThan(size(whole.value) / 3);
    // Every type the channel knows is in the list.
    const known = whole.value as KnownTypes;
    expect(types.checks.map((c) => c.type)).toEqual(known.checks.map((c) => c.type));
    expect(types.fixes.map((f) => f.type)).toEqual(known.remediations.map((r) => r.type));

    const one = await host.call(caller(), 'setup_types', { types: ['process.running'] });
    if (!one.ok) throw new Error(one.error.message);
    const detail = one.value as SetupTypes;
    expect(detail.checks).toHaveLength(1);
    expect(detail.checks[0]!.params).toEqual(
      known.checks.find((c) => c.type === 'process.running')!.schema
    );
    expect(size(detail)).toBeLessThan(2000);
  });
});
