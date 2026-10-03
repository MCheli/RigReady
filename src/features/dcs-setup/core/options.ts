import {
  formatLuaNumber,
  LuaTable,
  parseLuaData,
  writeLuaDocument,
  type LuaValue,
} from '../../../core/lua/data';
import { err, ok, type Result } from '../../../core/result';

/**
 * Saved Games\DCS\Config\options.lua: the settings worth checking before a flight, and
 * single-key edits that leave every other byte as DCS wrote it.
 */

export interface DcsOptions {
  /** graphics.multiMonitorSetup: the MonitorSetup file stem DCS uses. */
  multiMonitorSetup?: string;
  width?: number;
  height?: number;
  aspect?: number;
  fullScreen?: boolean;
  /** VR.enable */
  vr?: boolean;
}

export type OptionKey = keyof DcsOptions;

const PATHS: Record<OptionKey, [string, string]> = {
  multiMonitorSetup: ['graphics', 'multiMonitorSetup'],
  width: ['graphics', 'width'],
  height: ['graphics', 'height'],
  aspect: ['graphics', 'aspect'],
  fullScreen: ['graphics', 'fullScreen'],
  vr: ['VR', 'enable'],
};

export const OPTION_LABELS: Record<OptionKey, string> = {
  multiMonitorSetup: 'monitor setup',
  width: 'width',
  height: 'height',
  aspect: 'aspect ratio',
  fullScreen: 'full screen',
  vr: 'VR',
};

function optionsTable(text: string): Result<LuaTable> {
  const document = parseLuaData(text);
  if (!document.ok) return document;
  const options = document.value.table('options');
  if (!options) return err('dcs.options', 'options.lua has no options table.');
  return ok(options);
}

const typed = (key: OptionKey, value: LuaValue | undefined): DcsOptions[OptionKey] => {
  if (key === 'multiMonitorSetup') return typeof value === 'string' ? value : undefined;
  if (key === 'fullScreen' || key === 'vr') return typeof value === 'boolean' ? value : undefined;
  return typeof value === 'number' ? value : undefined;
};

export function readOptions(text: string): Result<DcsOptions> {
  const options = optionsTable(text);
  if (!options.ok) return options;
  const out: DcsOptions = {};
  for (const key of Object.keys(PATHS) as OptionKey[]) {
    const [section, name] = PATHS[key];
    const value = typed(key, options.value.table(section)?.get(name));
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return ok(out);
}

export interface OptionChange {
  key: OptionKey;
  before: DcsOptions[OptionKey];
  after: NonNullable<DcsOptions[OptionKey]>;
}

/** "monitor setup "wwtMonitor" → "rigready"" */
export function describeChange(change: OptionChange): string {
  const show = (v: unknown): string =>
    v === undefined
      ? 'not set'
      : typeof v === 'string'
        ? `"${v}"`
        : typeof v === 'boolean'
          ? v
            ? 'on'
            : 'off'
          : formatLuaNumber(Number(v));
  return `${OPTION_LABELS[change.key]} ${show(change.before)} → ${show(change.after)}`;
}

/**
 * Sets the given keys and nothing else. Values already equal are not changes. Fails
 * when the file is not plain table data (RigReady never rewrites it from a model).
 */
export function editOptions(
  text: string,
  values: DcsOptions
): Result<{ text: string; changes: OptionChange[] }> {
  const document = parseLuaData(text);
  if (!document.ok) return document;
  const options = document.value.table('options');
  if (!options) return err('dcs.options', 'options.lua has no options table.');
  const changes: OptionChange[] = [];
  for (const key of Object.keys(values) as OptionKey[]) {
    const after = values[key];
    if (after === undefined) continue;
    const [section, name] = PATHS[key];
    let table = options.table(section);
    if (!table) {
      table = new LuaTable();
      options.set(section, table);
    }
    const before = typed(key, table.get(name));
    const same =
      typeof after === 'number' && typeof before === 'number'
        ? Math.abs(after - before) < 1e-9
        : before === after;
    if (same) continue;
    table.set(name, after);
    changes.push({ key, before, after });
  }
  return ok({ text: changes.length ? writeLuaDocument(document.value) : text, changes });
}
