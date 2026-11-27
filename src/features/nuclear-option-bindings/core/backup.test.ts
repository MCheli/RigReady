import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { CheckContext } from '../../../core/checks/registry';
import { err } from '../../../core/result';
import { nuclearOptionBackupSource, recordValues } from './backup';

/**
 * What a full backup keeps of Nuclear Option: its registry values as a record, on
 * fixtures/scenarios/nuclear-option-bindings.yaml.
 */
describe('Nuclear Option in a full backup', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  const source = (a: WiredApp) =>
    a.wiring.context.backupSources.all().find((s) => s.id === 'nuclear-option')!;

  it('keeps every registry value of the game as one record, with a table a person can read', async () => {
    app = await wiredApp('nuclear-option-bindings');
    const records = await source(app).records!(app.ctx);
    if (!records.ok) throw new Error(records.error.message);
    expect(records.value).toHaveLength(1);
    const record = records.value[0]!;
    expect(record).toMatchObject({
      id: 'registry',
      label: 'Nuclear Option settings and bindings (registry)',
      from: 'HKEY_CURRENT_USER\\Software\\Shockfront\\NuclearOption',
    });
    // The raw values, exactly as read: what a restore would need.
    const raw = (record.data as { values: Record<string, { type: string }> }).values;
    expect(Object.keys(raw)).toHaveLength(10);
    expect(raw.UseTrackIR_h3800713042).toEqual({ type: 'number', value: 0 });

    const rows = record.values!.map((v) => `${v.group}: ${v.label} = ${v.value}`);
    expect(rows).toEqual([
      // The stick twice: as a current game build saved it, and the map an earlier build left.
      'Bindings: Joystick - HOTAS Warthog (Game) = 8 bindings',
      'Bindings: Joystick - HOTAS Warthog (Game) = 2 bindings',
      'Bindings: Keyboard (Chat) = 1 binding',
      'Bindings: Keyboard (Game) = 5 bindings',
      'Bindings: Mouse (Game) = 3 bindings',
      'Bindings: T-Rudder (Game) = 1 binding',
      'Bindings: Throttle - HOTAS Warthog (Chat) = 0 bindings',
      'Bindings: Throttle - HOTAS Warthog (Game) = 8 bindings',
      'Settings: UseTrackIR = 0',
      'Other input data: ControllerMap_KnownActionIds = 39 bytes',
    ]);
    // It offers no file: the game has none.
    expect(await source(app).suggest(app.ctx)).toEqual({ ok: true, value: [] });
  });

  it('keeps nothing when the game has saved nothing', async () => {
    app = await wiredApp('games-nuclear-option');
    expect(await source(app).records!(app.ctx)).toEqual({ ok: true, value: [] });
  });

  it('a registry that cannot be read is an error the backup hears, not an empty record list', async () => {
    const failing = {
      ports: {
        registry: { listValues: async () => err('registry.read', 'Could not read the key.') },
      },
    } as unknown as CheckContext;
    expect(await nuclearOptionBackupSource.records!(failing)).toEqual({
      ok: false,
      error: { code: 'registry.read', message: 'Could not read the key.' },
    });
  });

  it('a string setting of eight bytes is shown as its text, not as a number', () => {
    const text = (s: string): { type: 'binary'; value: string } => ({
      type: 'binary',
      value: Buffer.from(`${s}\0`, 'utf8').toString('hex'),
    });
    const zero = { type: 'binary' as const, value: '00'.repeat(8) };
    const rows = recordValues({
      Preset_h1: text('default'),
      Name_h2: text('Viper'),
      Volume_h3: zero,
    }).map((v) => `${v.label} = ${v.value}`);
    expect(rows).toEqual(['Name = Viper', 'Preset = default', 'Volume = 0']);
  });

  it('shows a float setting as a number, a map that cannot be read as such, and long data by its size', () => {
    const float = Buffer.alloc(8);
    float.writeDoubleLE(0.75);
    const rows = recordValues({
      ViewSensitivity_h864710853: { type: 'binary', value: float.toString('hex') },
      'RewiredSaveData|playerName=Player0|dataType=ControllerMap|kv=2|controllerMapType=MouseMap|categoryId=0_h1':
        { type: 'binary', value: Buffer.from('nonsense', 'utf8').toString('hex') },
      'RewiredSaveData|dataType=CalibrationMap|controllerType=Joystick_h2': {
        type: 'binary',
        value: 'ab'.repeat(500),
      },
    }).map((v) => `${v.label} = ${v.value}`);
    expect(rows).toEqual([
      'Mouse (Game) = Could not be read',
      'ViewSensitivity = 0.75',
      'CalibrationMap = 500 bytes',
    ]);
  });
});
