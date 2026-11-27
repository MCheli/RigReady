import type { BackupRecordValue, BackupSource } from '../../../core/backupSources';
import { ok } from '../../../core/result';
import type { RegistryValue } from '../../../shared/models';
import { mapCategoryName } from './actions';
import { parseControllerMap, parseSaveKey, textOfBinary } from './rewired';
import { GAME_NAME, REGISTRY_KEY } from './view';

/**
 * Nuclear Option keeps its settings and bindings in the registry, so there is no file for
 * a backup to hold. Every full backup keeps the registry values as a record instead: they
 * can be read back there, and nothing puts them back (the registry port only reads).
 */

/** A PlayerPrefs name without the `_h<number>` Unity adds. */
const plainName = (name: string): string => name.replace(/_h\d+$/, '');

/** A setting's value for reading: Unity stores a float as eight bytes, a string as bytes. */
function settingText(value: RegistryValue): string {
  if (value.type === 'number') return String(value.value);
  if (value.type === 'string') return value.value;
  if (value.type === 'strings') return value.value.join(', ');
  if (value.value.length === 16) {
    const float = Buffer.from(value.value, 'hex').readDoubleLE(0);
    if (Number.isFinite(float)) return String(Number(float.toFixed(4)));
  }
  const text = textOfBinary(value.value)?.replace(/\0+$/, '');
  if (text !== undefined && /^[\x20-\x7e]*$/.test(text)) {
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }
  return `${value.value.length / 2} bytes`;
}

/** The record's table: the bindings by controller, then the game's own settings. */
export function recordValues(values: Record<string, RegistryValue>): BackupRecordValue[] {
  const maps: BackupRecordValue[] = [];
  const other: BackupRecordValue[] = [];
  const settings: BackupRecordValue[] = [];
  for (const [name, value] of Object.entries(values)) {
    const key = parseSaveKey(name);
    if (!key) {
      settings.push({ group: 'Settings', label: plainName(name), value: settingText(value) });
      continue;
    }
    if (key.dataType !== 'ControllerMap') {
      other.push({
        group: 'Other input data',
        label: key.dataType,
        name: plainName(name),
        value: value.type === 'binary' ? `${value.value.length / 2} bytes` : settingText(value),
      });
      continue;
    }
    const text = value.type === 'binary' ? textOfBinary(value.value) : undefined;
    const map = text === undefined ? undefined : parseControllerMap(text);
    const device =
      map?.ok && map.value.hardwareName
        ? map.value.hardwareName
        : key.parts.controllerMapType === 'KeyboardMap'
          ? 'Keyboard'
          : key.parts.controllerMapType === 'MouseMap'
            ? 'Mouse'
            : 'A controller';
    const count = map?.ok ? map.value.buttonMaps.length + map.value.axisMaps.length : undefined;
    maps.push({
      group: 'Bindings',
      label: `${device} (${mapCategoryName(Number(key.parts.categoryId ?? '0'))})`,
      name: plainName(name),
      value:
        count === undefined
          ? 'Could not be read'
          : `${count} ${count === 1 ? 'binding' : 'bindings'}`,
    });
  }
  const byLabel = (a: BackupRecordValue, b: BackupRecordValue): number =>
    a.label.localeCompare(b.label) || (a.name ?? '').localeCompare(b.name ?? '');
  return [...maps.sort(byLabel), ...settings.sort(byLabel), ...other.sort(byLabel)];
}

export const nuclearOptionBackupSource: BackupSource = {
  id: 'nuclear-option',
  label: GAME_NAME,
  // No file: the game has none.
  suggest: async () => ok([]),
  async records(ctx) {
    const values = await ctx.ports.registry.listValues('HKCU', REGISTRY_KEY);
    if (!values.ok || Object.keys(values.value).length === 0) return ok([]);
    return ok([
      {
        id: 'registry',
        label: 'Nuclear Option settings and bindings (registry)',
        from: `HKEY_CURRENT_USER\\${REGISTRY_KEY}`,
        data: { values: values.value },
        values: recordValues(values.value),
      },
    ]);
  },
};
