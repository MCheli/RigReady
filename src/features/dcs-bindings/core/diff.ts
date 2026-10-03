import { LuaDocument, LuaTable, luaDocument, type LuaValue } from '../../../core/lua/data';

/**
 * The model of one DCS binding diff file (docs/research/dcs.md 1.4), read from and
 * edited on the parsed Lua tables, so everything RigReady does not understand
 * (ffDiffs, `column`, unknown keys) is written back untouched.
 */

export type CommandKind = 'key' | 'axis';

export interface AxisFilter {
  deadzone: number;
  saturationX: number;
  saturationY: number;
  hardwareDetent: boolean;
  hardwareDetentAB: number;
  hardwareDetentMax: number;
  invert: boolean;
  slider: boolean;
  /** One value is DCS's standard curve; several are a user curve with that many points. */
  curvature: number[];
}

/** DCS's createAxisFilter defaults. */
export const DEFAULT_FILTER: AxisFilter = {
  deadzone: 0,
  saturationX: 1,
  saturationY: 1,
  hardwareDetent: false,
  hardwareDetentAB: 0,
  hardwareDetentMax: 0,
  invert: false,
  slider: false,
  curvature: [0],
};

export interface Combo {
  /** DCS event name: JOY_BTN5, JOY_BTN_POV1_U, JOY_X, LShift. */
  key: string;
  /** Modifier names; order does not matter. */
  reformers: string[];
  filter?: AxisFilter;
}

export type DiffSection = 'added' | 'removed' | 'changed';

export interface DiffEntry {
  kind: CommandKind;
  /** DCS's command hash: d..p..u..cd..vd..vp..vu.. or a..cd.. */
  hash: string;
  /** The action's name as DCS saved it (localized, a label only). */
  name: string;
  added: Combo[];
  removed: Combo[];
  changed: Combo[];
}

export interface DiffModel {
  entries: DiffEntry[];
  /** Force-feedback settings are present (kept as they are). */
  hasForceFeedback: boolean;
}

const SECTION_OF_KIND: Record<CommandKind, string> = { key: 'keyDiffs', axis: 'axisDiffs' };

/** Identity of a combo: its key plus the set of modifiers. */
export function comboId(combo: { key: string; reformers?: string[] }): string {
  return [combo.key, ...[...(combo.reformers ?? [])].sort()].join('+');
}

export const sameCombo = (
  a: { key: string; reformers?: string[] },
  b: { key: string; reformers?: string[] }
): boolean => comboId(a) === comboId(b);

/** A filter from whatever a file holds; missing fields take DCS's defaults. */
export function filterFromLua(value: LuaValue | undefined): AxisFilter | undefined {
  if (!(value instanceof LuaTable)) return undefined;
  const number = (key: string, fallback: number): number => {
    const v = value.get(key);
    return typeof v === 'number' ? v : fallback;
  };
  const flag = (key: string): boolean => value.get(key) === true;
  const curve = value.table('curvature');
  const points = curve
    ? curve.entries.map((e) => e.value).filter((v) => typeof v === 'number')
    : [];
  return {
    deadzone: number('deadzone', 0),
    saturationX: number('saturationX', 1),
    saturationY: number('saturationY', 1),
    hardwareDetent: flag('hardwareDetent'),
    hardwareDetentAB: number('hardwareDetentAB', 0),
    hardwareDetentMax: number('hardwareDetentMax', 0),
    invert: flag('invert'),
    slider: flag('slider'),
    curvature: points.length > 0 ? (points as number[]) : [0],
  };
}

/** The filter table exactly as DCS writes it: every field, keys in byte order. */
export function filterToLua(filter: AxisFilter): LuaTable {
  return LuaTable.from({
    curvature: filter.curvature.length > 0 ? filter.curvature : [0],
    deadzone: filter.deadzone,
    hardwareDetent: filter.hardwareDetent,
    hardwareDetentAB: filter.hardwareDetentAB,
    hardwareDetentMax: filter.hardwareDetentMax,
    invert: filter.invert,
    saturationX: filter.saturationX,
    saturationY: filter.saturationY,
    slider: filter.slider,
  }) as LuaTable;
}

export function sameFilter(a: AxisFilter | undefined, b: AxisFilter | undefined): boolean {
  const x = a ?? DEFAULT_FILTER;
  const y = b ?? DEFAULT_FILTER;
  return (
    x.deadzone === y.deadzone &&
    x.saturationX === y.saturationX &&
    x.saturationY === y.saturationY &&
    x.hardwareDetent === y.hardwareDetent &&
    x.hardwareDetentAB === y.hardwareDetentAB &&
    x.hardwareDetentMax === y.hardwareDetentMax &&
    x.invert === y.invert &&
    x.slider === y.slider &&
    x.curvature.length === y.curvature.length &&
    x.curvature.every((value, index) => value === y.curvature[index])
  );
}

export const isDefaultFilter = (filter: AxisFilter | undefined): boolean =>
  sameFilter(filter, DEFAULT_FILTER);

export function comboFromLua(value: LuaValue): Combo | undefined {
  if (!(value instanceof LuaTable)) return undefined;
  const key = value.get('key');
  if (typeof key !== 'string') return undefined;
  const reformers = (value.table('reformers')?.entries ?? [])
    .map((e) => e.value)
    .filter((v): v is string => typeof v === 'string');
  const filter = filterFromLua(value.get('filter'));
  return { key, reformers, ...(filter ? { filter } : {}) };
}

function comboToLua(combo: Combo, withFilter: boolean): LuaTable {
  const table = new LuaTable();
  if (withFilter && combo.filter) table.set('filter', filterToLua(combo.filter));
  table.set('key', combo.key);
  if (combo.reformers.length > 0) table.set('reformers', LuaTable.from(combo.reformers));
  return table;
}

function combosOf(entry: LuaTable, section: DiffSection): Combo[] {
  return (entry.table(section)?.entries ?? [])
    .map((e) => comboFromLua(e.value))
    .filter((c): c is Combo => c !== undefined);
}

/** The diff table of a document: `local diff = {...}`, or whatever variable the file returns. */
export function diffTable(document: LuaDocument): LuaTable | undefined {
  const returned = document.statements.find((s) => s.kind === 'return')?.name ?? 'diff';
  return document.table(returned) ?? document.table('diff');
}

export function readDiff(document: LuaDocument): DiffModel {
  const diff = diffTable(document);
  const entries: DiffEntry[] = [];
  for (const kind of ['axis', 'key'] as const) {
    const section = diff?.table(SECTION_OF_KIND[kind]);
    for (const { key, value } of section?.entries ?? []) {
      if (!(value instanceof LuaTable)) continue;
      const name = value.get('name');
      entries.push({
        kind,
        hash: String(key),
        name: typeof name === 'string' ? name : '',
        added: combosOf(value, 'added'),
        removed: combosOf(value, 'removed'),
        changed: combosOf(value, 'changed'),
      });
    }
  }
  const ff = diff?.table('ffDiffs');
  return { entries, hasForceFeedback: ff !== undefined && ff.size > 0 };
}

/** A new, empty diff document in DCS's shape. */
export function newDiffDocument(): LuaDocument {
  return luaDocument('diff', new LuaTable());
}

/** Lua's `<` on strings is byte order; DCS writes table keys sorted that way. */
function byteCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sets a string key, inserting a new one where DCS's sorted serializer would put it. */
function setSorted(table: LuaTable, key: string, value: LuaValue): void {
  if (table.has(key)) {
    table.set(key, value);
    return;
  }
  const at = table.entries.findIndex(
    (e) => typeof e.key === 'string' && byteCompare(e.key, key) > 0
  );
  if (at < 0) table.entries.push({ key, value });
  else table.entries.splice(at, 0, { key, value });
}

function renumber(list: LuaTable): void {
  list.entries.forEach((entry, index) => (entry.key = index + 1));
}

function findComboIndex(list: LuaTable | undefined, combo: Combo): number {
  if (!list) return -1;
  return list.entries.findIndex((e) => {
    const found = comboFromLua(e.value);
    return found !== undefined && sameCombo(found, combo);
  });
}

/** True when the combo is listed in that section of the command's entry. */
export function hasCombo(
  document: LuaDocument,
  kind: CommandKind,
  hash: string,
  section: DiffSection,
  combo: Combo
): boolean {
  const entry = diffTable(document)?.table(SECTION_OF_KIND[kind])?.table(hash);
  return findComboIndex(entry?.table(section), combo) >= 0;
}

/**
 * Adds a combo to a section of a command's entry (creating the entry, with its name,
 * when needed). An existing combo with the same key and modifiers is replaced.
 * `removed` combos never carry a filter; `added` ones only a non-default one; `changed`
 * ones always the full filter — as DCS writes them.
 */
export function putCombo(
  document: LuaDocument,
  kind: CommandKind,
  hash: string,
  name: string,
  section: DiffSection,
  combo: Combo
): void {
  let diff = diffTable(document);
  if (!diff) {
    diff = new LuaTable();
    document.set('diff', diff, { local: true });
  }
  let commands = diff.table(SECTION_OF_KIND[kind]);
  if (!commands) {
    commands = new LuaTable();
    setSorted(diff, SECTION_OF_KIND[kind], commands);
  }
  let entry = commands.table(hash);
  if (!entry) {
    entry = new LuaTable();
    entry.set('name', name);
    setSorted(commands, hash, entry);
  }
  let list = entry.table(section);
  if (!list) {
    list = new LuaTable();
    setSorted(entry, section, list);
  }
  const withFilter =
    section === 'changed' || (section === 'added' && !isDefaultFilter(combo.filter));
  const value = comboToLua(
    section === 'changed' ? { ...combo, filter: combo.filter ?? DEFAULT_FILTER } : combo,
    withFilter
  );
  const at = findComboIndex(list, combo);
  if (at >= 0) {
    // Keep fields RigReady does not model (e.g. `column`) on the existing combo.
    const existing = list.entries[at]!.value as LuaTable;
    for (const extra of existing.entries) {
      if (typeof extra.key === 'string' && !['filter', 'key', 'reformers'].includes(extra.key)) {
        setSorted(value, extra.key, extra.value);
      }
    }
    list.entries[at]!.value = value;
  } else {
    list.entries.push({ key: list.entries.length + 1, value });
  }
}

/** Removes a combo from a section; tidies away tables that end up empty. True when it was there. */
export function dropCombo(
  document: LuaDocument,
  kind: CommandKind,
  hash: string,
  section: DiffSection,
  combo: Combo
): boolean {
  const diff = diffTable(document);
  const commands = diff?.table(SECTION_OF_KIND[kind]);
  const entry = commands?.table(hash);
  const list = entry?.table(section);
  const at = findComboIndex(list, combo);
  if (!diff || !commands || !entry || !list || at < 0) return false;
  list.entries.splice(at, 1);
  renumber(list);
  if (list.size === 0) entry.delete(section);
  if (!entry.has('added') && !entry.has('removed') && !entry.has('changed')) commands.delete(hash);
  if (commands.size === 0) diff.delete(SECTION_OF_KIND[kind]);
  return true;
}

/** DCS deletes a diff file that has no axis, key or force-feedback entries. */
export function isEmptyDiff(document: LuaDocument): boolean {
  const diff = diffTable(document);
  if (!diff) return true;
  return ['axisDiffs', 'keyDiffs', 'ffDiffs'].every((key) => (diff.table(key)?.size ?? 0) === 0);
}
