import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import { LuaTable, type LuaValue } from '../../../core/lua/data';
import { runLua } from '../../../core/lua/sandbox';
import type { Rect } from './screens';

/**
 * Reads MonitorSetup files the way DCS does: they are Lua programs (ED's own use `if
 * displays ...`), so they run in the sandbox with `screen` and `displays`, and the
 * rectangles they define are read back.
 */

export interface MonitorSetupFile {
  /** Absolute path. */
  path: string;
  /** user = Saved Games\DCS\Config\MonitorSetup, install = <DCS>\Config\MonitorSetup. */
  folder: 'user' | 'install';
  /** File name without .lua. */
  stem: string;
  /** Display name from the file's `name`. */
  name: string;
  description: string;
  /** 3D views (Viewports.Center, Left, Right, ...). */
  cameras: { name: string; rect: Rect }[];
  /** Exported displays (LEFT_MFCD, ...), in the coordinates the file gives (DCS window). */
  exports: { name: string; rect: Rect }[];
  /** Why the file could not be read. */
  error?: string;
}

const EPILOGUE = `
dofile('monitor-setup')
if type(reconfigure_for_unit) == 'function' and __rr_unit then reconfigure_for_unit(__rr_unit) end
local function rect(v)
  if type(v) == 'table' and type(v.x) == 'number' and type(v.y) == 'number'
     and type(v.width) == 'number' and type(v.height) == 'number' then
    return { x = v.x, y = v.y, width = v.width, height = v.height }
  end
end
local exports, cameras = {}, {}
for k, v in pairs(_G) do
  -- Exported displays are named in capitals (LEFT_MFCD); lower-case globals are a file's helpers.
  if type(k) == 'string' and k:match('^[A-Z][A-Z0-9_]*$') and k ~= 'GU_MAIN_VIEWPORT' then
    exports[k] = rect(v)
  end
end
if type(Viewports) == 'table' then
  for k, v in pairs(Viewports) do cameras[tostring(k)] = rect(v) end
end
__rr_exports = exports
__rr_cameras = cameras
__rr_name = type(name) == 'string' and name or nil
__rr_description = type(Description) == 'string' and Description or nil
`;

const PRELUDE = '_ = function(p) return p end';

function rects(value: LuaValue | undefined): { name: string; rect: Rect }[] {
  if (!(value instanceof LuaTable)) return [];
  const out: { name: string; rect: Rect }[] = [];
  for (const { key, value: entry } of value.entries) {
    if (!(entry instanceof LuaTable)) continue;
    const n = (k: string): number => {
      const v = entry.get(k);
      return typeof v === 'number' ? Math.round(v) : 0;
    };
    out.push({
      name: String(key),
      rect: { x: n('x'), y: n('y'), width: n('width'), height: n('height') },
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface EvaluateOptions {
  /** The DCS window: options.lua width and height. */
  screen: { width: number; height: number };
  /** Enabled monitors in desktop coordinates. */
  displays: Rect[];
  /** Evaluate as this unit type would see it (reconfigure_for_unit). */
  unit?: string;
}

/** Runs one MonitorSetup file's text and returns its name and rectangles. */
export function evaluateMonitorSetup(
  text: string,
  options: EvaluateOptions
): Omit<MonitorSetupFile, 'path' | 'folder' | 'stem'> {
  const { width, height } = options.screen;
  const run = runLua(EPILOGUE, {
    name: 'MonitorSetup',
    prelude: PRELUDE,
    files: (requested) => (requested === 'monitor-setup' ? text : undefined),
    globals: {
      screen: LuaTable.from({ x: 0, y: 0, width, height, aspect: height ? width / height : 1 }),
      displays: LuaTable.from(options.displays.map((d) => ({ ...d }))),
      ...(options.unit ? { __rr_unit: options.unit } : {}),
    },
    read: ['__rr_exports', '__rr_cameras', '__rr_name', '__rr_description'],
    maxInstructions: 2_000_000,
  });
  if (!run.ok) {
    return {
      name: '',
      description: '',
      cameras: [],
      exports: [],
      error: run.error.detail ? `${run.error.message} ${run.error.detail}` : run.error.message,
    };
  }
  const g = run.value.globals;
  return {
    name: typeof g['__rr_name'] === 'string' ? g['__rr_name'] : '',
    description: typeof g['__rr_description'] === 'string' ? g['__rr_description'] : '',
    cameras: rects(g['__rr_cameras']),
    exports: rects(g['__rr_exports']),
  };
}

/** Every MonitorSetup file DCS can choose from: Saved Games first, then the install's. */
export async function listMonitorSetups(
  ctx: CheckContext,
  folders: { user?: string; install?: string },
  options: EvaluateOptions
): Promise<MonitorSetupFile[]> {
  const out: MonitorSetupFile[] = [];
  for (const [folder, base] of [
    ['user', folders.user],
    ['install', folders.install],
  ] as const) {
    if (!base) continue;
    const dir = path.join(base, 'Config', 'MonitorSetup');
    const entries = await ctx.ports.files.listEntries(dir);
    if (!entries.ok) continue;
    for (const entry of entries.value.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory || !/\.lua$/i.test(entry.name)) continue;
      const stem = entry.name.slice(0, -4);
      const text = await ctx.ports.files.readText(entry.path);
      const evaluated = text.ok
        ? evaluateMonitorSetup(text.value, options)
        : { name: '', description: '', cameras: [], exports: [], error: text.error.message };
      out.push({ path: entry.path, folder, stem, ...evaluated, name: evaluated.name || stem });
    }
  }
  return out;
}

/** The file options.lua names: DCS matches the stem without regard to case, Saved Games first. */
export function findSetup(
  files: MonitorSetupFile[],
  option: string | undefined
): MonitorSetupFile | undefined {
  if (!option) return undefined;
  const wanted = option.toLowerCase();
  return files.find((f) => f.stem.toLowerCase() === wanted);
}
