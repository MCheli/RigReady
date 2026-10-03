import path from 'node:path';
import { LuaTable, formatLuaNumber, type LuaValue } from '../../../core/lua/data';
import { runLua } from '../../../core/lua/sandbox';
import { isWithin } from '../../../core/paths';
import type { FileStore } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { comboFromLua, type Combo, type CommandKind } from './diff';

/**
 * Loads the input defaults DCS ships: the aircraft's `default.lua` (or a device-specific
 * layout), which is a real Lua program, evaluated in the sandbox with the helper
 * functions DCS gives it (docs/research/dcs.md 1.5 and 1.6). Nothing is ever read
 * outside the DCS install folder.
 */

export type FieldValue = number | string | boolean | null;

/** The fields DCS builds a command's hash from. A string is an engine command name (iCommand...). */
export interface CommandFields {
  down?: FieldValue;
  pressed?: FieldValue;
  up?: FieldValue;
  cockpit_device_id?: FieldValue;
  value_down?: FieldValue;
  value_pressed?: FieldValue;
  value_up?: FieldValue;
  action?: FieldValue;
}

export const KEY_HASH_FIELDS = [
  ['down', 'd'],
  ['pressed', 'p'],
  ['up', 'u'],
  ['cockpit_device_id', 'cd'],
  ['value_down', 'vd'],
  ['value_pressed', 'vp'],
  ['value_up', 'vu'],
] as const;

export const AXIS_HASH_FIELDS = [
  ['action', 'a'],
  ['cockpit_device_id', 'cd'],
] as const;

export interface DefaultCombo extends Combo {
  /**
   * Set when DCS picked this combo through DefaultAssignments.lua ("roll", "pitch",
   * "rudder", "thrust", "left_wheel_brake", "fire", ...): what the binding is for.
   */
  assignment?: string;
}

export interface DefaultCommand {
  kind: CommandKind;
  fields: CommandFields;
  /** English name (the text inside _()). */
  name: string;
  category: string[];
  combos: DefaultCombo[];
}

export interface DefaultLayout {
  /** The file the layout came from. */
  file: string;
  commands: DefaultCommand[];
}

/** Lua's tostring() of a hash field: `nil` for a missing one, %.14g for numbers. */
export function fieldText(value: FieldValue | undefined): string {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'number') return formatLuaNumber(value);
  return String(value);
}

/**
 * The hash DCS keys a diff entry on. Engine command names are replaced through
 * `resolve`; a name it does not know stays in the hash, which then cannot match a file.
 */
export function commandHash(
  kind: CommandKind,
  fields: CommandFields,
  resolve: (name: string) => number | undefined = () => undefined
): string {
  const parts = kind === 'key' ? KEY_HASH_FIELDS : AXIS_HASH_FIELDS;
  return parts
    .map(([field, prefix]) => {
      const value = fields[field as keyof CommandFields];
      const resolved = typeof value === 'string' ? (resolve(value) ?? value) : value;
      return `${prefix}${fieldText(resolved)}`;
    })
    .join('');
}

/** Engine command names in a command that `resolve` does not know. */
export function unresolvedNames(
  kind: CommandKind,
  fields: CommandFields,
  resolve: (name: string) => number | undefined
): string[] {
  const parts = kind === 'key' ? KEY_HASH_FIELDS : AXIS_HASH_FIELDS;
  const names: string[] = [];
  for (const [field] of parts) {
    const value = fields[field as keyof CommandFields];
    if (typeof value === 'string' && resolve(value) === undefined) names.push(value);
  }
  return names;
}

/**
 * The functions DCS's loader hands to an input layout file, written in Lua and
 * mirroring Scripts/Input/Data.lua. Unknown globals (the engine's iCommand numbers,
 * which exist in no file) resolve to their own name.
 */
const PRELUDE = `
setmetatable(_G, { __index = function(_, name) return name end })
function _(text) return text end
function join(to, from)
  for _, v in ipairs(from) do to[#to + 1] = v end
  return to
end
function ignore_features() end
function bindKeyboardCommandsToMouse() end
function external_profile(file, folder_new)
  local old_folder, old_filename = folder, filename
  if folder_new then folder = folder_new end
  filename = file
  local res = dofile(file)
  folder, filename = old_folder, old_filename
  return res
end
function defaultFFB()
  local a = __assignments[deviceGenericName]
  if type(a) == 'table' and a.FFB then return a.FFB end
  return { trimmer = 1.0, shake = 0.5, swapAxes = false, invertX = false, invertY = false }
end
local function tagged(combo, name)
  local copy = {}
  for k, v in pairs(combo) do copy[k] = v end
  copy.__assignment = name
  return { copy }
end
function defaultDeviceAssignmentFor(name)
  local wizard = type(__wizard) == 'table' and __wizard[deviceName]
  if type(wizard) == 'table' then
    local w = wizard[name]
    if type(w) == 'table' and w.key ~= nil then return tagged(w, name) end
  end
  local assignments = __assignments[deviceGenericName]
  if type(assignments) ~= 'table' then assignments = __assignments.default end
  local assigned = assignments[name]
  if assigned ~= nil then
    if type(assigned) == 'table' then
      if assigned.key ~= nil then return tagged(assigned, name) end
    else
      return tagged({ key = assigned }, name)
    end
  end
  return nil
end
function MultiEngineDefaultDeviceAssignmentForThrust()
  local common = defaultDeviceAssignmentFor("thrust")
  local left = defaultDeviceAssignmentFor("thrust_left")
  local right = defaultDeviceAssignmentFor("thrust_right")
  if not common then return nil, left, right end
  if left and left[1].key and right and right[1].key then return nil, left, right end
  return common, nil, nil
end
`;

function isFieldValue(value: LuaValue | undefined): value is FieldValue {
  return value === null || ['number', 'string', 'boolean'].includes(typeof value);
}

function commandFromLua(kind: CommandKind, value: LuaValue): DefaultCommand | undefined {
  if (!(value instanceof LuaTable)) return undefined;
  const name = value.get('name');
  const fields: CommandFields = {};
  for (const [field] of kind === 'key' ? KEY_HASH_FIELDS : AXIS_HASH_FIELDS) {
    const v = value.get(field);
    if (v !== undefined && isFieldValue(v) && v !== null) fields[field as keyof CommandFields] = v;
  }
  const rawCategory = value.get('category');
  const category =
    typeof rawCategory === 'string'
      ? [rawCategory]
      : rawCategory instanceof LuaTable
        ? rawCategory.entries.map((e) => e.value).filter((v): v is string => typeof v === 'string')
        : [];
  const combos: DefaultCombo[] = [];
  for (const entry of value.table('combos')?.entries ?? []) {
    const combo = comboFromLua(entry.value);
    if (!combo) continue;
    const assignment = (entry.value as LuaTable).get('__assignment');
    combos.push({ ...combo, ...(typeof assignment === 'string' ? { assignment } : {}) });
  }
  return { kind, fields, name: typeof name === 'string' ? name : '', category, combos };
}

export interface LayoutRequest {
  /** The layout file: <folder>/<type>/default.lua or <folder>/<type>/<Template>.lua. */
  file: string;
  /** DCS's `folder` variable: the directory of the layout, with a trailing separator. */
  folder: string;
  /** The device name without its GUID; picks the entry of DefaultAssignments.lua. */
  deviceTemplate: string;
  /** The device's full id, the key of wizard.lua. */
  deviceFullId?: string;
  /** Parsed wizard.lua, when the user ran DCS's axis wizard. */
  wizard?: LuaTable;
}

export class DefaultsLoader {
  private readonly texts = new Map<string, string | null>();
  private readonly layouts = new Map<string, Result<DefaultLayout>>();
  private assignmentsTable: Result<LuaTable> | undefined;
  /** Set once a file used an escape Lua 5.1 accepts and the sandbox's Lua does not. */
  private lenientEscapes = false;

  constructor(
    private readonly files: FileStore,
    readonly installDir: string
  ) {}

  private key(file: string): string {
    return path.resolve(this.installDir, file).toLowerCase();
  }

  /** Reads a file below the install folder into the cache. Null when it is missing or outside. */
  private async fetch(file: string): Promise<string | null> {
    const key = this.key(file);
    const cached = this.texts.get(key);
    if (cached !== undefined) return cached;
    const absolute = path.resolve(this.installDir, file);
    let text: string | null = null;
    if (isWithin(this.installDir, absolute) && (await this.files.exists(absolute))) {
      const read = await this.files.readText(absolute);
      if (read.ok) text = read.value;
    }
    this.texts.set(key, text);
    return text;
  }

  /**
   * Runs a Lua file in the sandbox. The sandbox can only be handed files synchronously,
   * so a file it asks for and does not have yet is read and the run repeated.
   */
  private async run(
    file: string,
    globals: Record<string, LuaValue>,
    prelude?: string
  ): Promise<Result<LuaValue[]>> {
    const source = await this.fetch(file);
    if (source === null) return err('dcs.defaults.missing', `${file} does not exist.`);
    for (let attempt = 0; attempt < 60; attempt++) {
      let missing: string | undefined;
      const result = runLua(this.prepare(source), {
        name: path.basename(file),
        ...(prelude !== undefined ? { prelude } : {}),
        globals,
        files: (requested) => {
          const text = this.texts.get(this.key(requested));
          if (text === undefined) missing = requested;
          return text === null || text === undefined ? undefined : this.prepare(text);
        },
      });
      if (result.ok) return ok(result.value.returned);
      if (!this.lenientEscapes && /invalid escape sequence/.test(result.error.detail ?? '')) {
        this.lenientEscapes = true;
        continue;
      }
      if (missing === undefined) return result;
      if ((await this.fetch(missing)) === null) {
        return err(
          'dcs.defaults.missing',
          `${path.basename(file)} needs ${missing}, which is not in the DCS install.`
        );
      }
    }
    return err('dcs.defaults.missing', `${file} loads too many other files.`);
  }

  /**
   * DCS runs Lua 5.1, where an unknown escape such as "\%" is just the character. The
   * sandbox's Lua refuses those, so they are rewritten when a file turns out to use one.
   */
  private prepare(text: string): string {
    if (!this.lenientEscapes) return text;
    return text.replace(/\\([^abfnrtvxzu0-9\\"'\r\n])/g, '$1');
  }

  /** Scripts/Input/DefaultAssignments.lua: which axes DCS binds by default on which device. */
  async assignments(): Promise<Result<LuaTable>> {
    if (this.assignmentsTable) return this.assignmentsTable;
    const run = await this.run(path.join('Scripts', 'Input', 'DefaultAssignments.lua'), {});
    const table = run.ok ? run.value[0] : undefined;
    this.assignmentsTable = !run.ok
      ? run
      : table instanceof LuaTable
        ? ok(table)
        : err('dcs.defaults.assignments', 'DefaultAssignments.lua did not return a table.');
    return this.assignmentsTable;
  }

  /** Evaluates one layout file for one device. Results are cached per file and assignment set. */
  async layout(request: LayoutRequest): Promise<Result<DefaultLayout>> {
    const assignments = await this.assignments();
    // Without DefaultAssignments.lua only the generic defaults are known.
    const table = assignments.ok
      ? assignments.value
      : (LuaTable.from({
          default: {
            pitch: 'JOY_Y',
            roll: 'JOY_X',
            rudder: 'JOY_RZ',
            thrust: 'JOY_Z',
            fire: 'JOY_BTN1',
          },
        }) as LuaTable);
    const own = table.get(request.deviceTemplate);
    const wizardEntry = request.deviceFullId
      ? request.wizard?.get(request.deviceFullId)
      : undefined;
    const cacheKey = JSON.stringify([
      this.key(request.file),
      own instanceof LuaTable ? own.toJs() : null,
      wizardEntry instanceof LuaTable ? wizardEntry.toJs() : null,
    ]);
    const cached = this.layouts.get(cacheKey);
    if (cached) return cached;

    const run = await this.run(
      request.file,
      {
        folder: request.folder,
        filename: path.basename(request.file),
        deviceName: request.deviceFullId ?? request.deviceTemplate,
        deviceGenericName: request.deviceTemplate,
        __assignments: table,
        __wizard: request.wizard ?? new LuaTable(),
      },
      PRELUDE
    );
    let result: Result<DefaultLayout>;
    if (!run.ok) {
      result = run;
    } else {
      const profile = run.value[0];
      if (!(profile instanceof LuaTable)) {
        result = err('dcs.defaults.shape', `${request.file} did not return an input layout.`);
      } else {
        const commands: DefaultCommand[] = [];
        for (const [list, kind] of [
          ['keyCommands', 'key'],
          ['axisCommands', 'axis'],
        ] as const) {
          for (const entry of profile.table(list)?.entries ?? []) {
            const command = commandFromLua(kind, entry.value);
            if (command) commands.push(command);
          }
        }
        result = ok({ file: request.file, commands });
      }
    }
    this.layouts.set(cacheKey, result);
    return result;
  }

  /** The table a plain `return {...}` file gives (modifiers.lua); undefined when it does not. */
  async table(file: string): Promise<LuaTable | undefined> {
    if (!(await this.has(file))) return undefined;
    const run = await this.run(file, {});
    const first = run.ok ? run.value[0] : undefined;
    return first instanceof LuaTable ? first : undefined;
  }

  /** Whether a file below the install exists (cached with its text). */
  async has(file: string): Promise<boolean> {
    return (await this.fetch(file)) !== null;
  }

  /** The text of a file below the install, or null. */
  text(file: string): Promise<string | null> {
    return this.fetch(file);
  }
}
