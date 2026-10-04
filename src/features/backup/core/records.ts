import type { BackupRecordValue } from '../../../core/backupSources';

/**
 * Records ("Kept as a record": settings that are not files) as a person reads them: one
 * row per stored value. A source may hand the rows over itself (with friendly labels);
 * for one that does not, and for backups made before sources could, the rows are derived
 * from the stored data.
 */
export interface RecordRow {
  /** Heading the row is listed under; '' for values at the top. */
  group: string;
  label: string;
  /** The name as stored, when the label is a friendlier one. */
  name?: string;
  value: string;
}

export const GROUP_SEPARATOR = ' › ';
/** Rows kept per record: more than any settings key holds, small enough to render. */
export const MAX_RECORD_ROWS = 2000;
const MAX_TEXT = 200;
const MAX_VALUE = 400;

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Long hex data as its first bytes and its size; short data as it is. */
export function shortBinary(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  const bytes = Math.floor(clean.length / 2);
  if (bytes <= 16) return clean.replace(/(..)(?=.)/g, '$1 ').toUpperCase() || '(empty)';
  const head = clean
    .slice(0, 16)
    .replace(/(..)(?=.)/g, '$1 ')
    .toUpperCase();
  return `${head} … (${bytes} bytes)`;
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return '(none)';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null)) {
    return value.length === 0 ? '(empty)' : value.map((v) => String(v)).join(', ');
  }
  return JSON.stringify(value);
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A registry value as the registry port gives it: { type, value }. */
function typedValue(value: unknown): string | undefined {
  if (!isPlain(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.length !== 2 || typeof value['type'] !== 'string' || !('value' in value))
    return undefined;
  const inner = value['value'];
  if (isPlain(inner)) return undefined;
  if (value['type'] === 'binary' && typeof inner === 'string') return shortBinary(inner);
  return scalarText(inner);
}

/**
 * Rows from stored data nobody described: every leaf with the path to it as its group.
 * The containers of an exported registry key ("values", "keys") are not levels a reader
 * cares about and are passed through.
 */
export function rowsFromData(data: unknown): RecordRow[] {
  const rows: RecordRow[] = [];
  const walk = (node: unknown, trail: string[]): void => {
    if (rows.length >= MAX_RECORD_ROWS) return;
    if (!isPlain(node)) {
      rows.push({
        group: trail.slice(0, -1).join(GROUP_SEPARATOR),
        label: trail[trail.length - 1] ?? 'Value',
        value: clip(scalarText(node), MAX_VALUE),
      });
      return;
    }
    const names = Object.keys(node);
    const registryKey =
      names.length > 0 &&
      names.every((n) => n === 'values' || n === 'keys') &&
      names.every((n) => isPlain(node[n]));
    if (registryKey) {
      for (const n of ['values', 'keys']) if (n in node) walk(node[n], trail);
      return;
    }
    // Leaves first, so a group's own values are listed before its sub-groups.
    const nested: string[] = [];
    for (const name of names) {
      const typed = typedValue(node[name]);
      if (typed !== undefined || !isPlain(node[name])) {
        if (rows.length >= MAX_RECORD_ROWS) return;
        rows.push({
          group: trail.join(GROUP_SEPARATOR),
          label: clip(name, MAX_TEXT),
          value: clip(typed ?? scalarText(node[name]), MAX_VALUE),
        });
      } else nested.push(name);
    }
    for (const name of nested) walk(node[name], [...trail, name]);
  };
  walk(data, []);
  return rows;
}

/** What a source handed over, within the limits the manifest allows. */
export function cleanValues(values: BackupRecordValue[]): BackupRecordValue[] {
  return values.slice(0, MAX_RECORD_ROWS).map((v) => ({
    ...(v.group ? { group: clip(v.group, MAX_TEXT) } : {}),
    label: clip(v.label, MAX_TEXT),
    ...(v.name && v.name !== v.label ? { name: clip(v.name, MAX_TEXT) } : {}),
    value: clip(v.value, MAX_VALUE),
  }));
}

/** The rows of a stored record: the source's own when it gave any, derived otherwise. */
export function recordRows(values: BackupRecordValue[] | undefined, text: string): RecordRow[] {
  if (values && values.length > 0) {
    return values.map((v) => ({
      group: v.group ?? '',
      label: v.label,
      ...(v.name ? { name: v.name } : {}),
      value: v.value,
    }));
  }
  try {
    return rowsFromData(JSON.parse(text));
  } catch {
    // A record that is not JSON has no rows to show; the record itself is still listed.
    return [];
  }
}
