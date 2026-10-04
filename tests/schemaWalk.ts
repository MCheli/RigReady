import type { z } from 'zod';
import type { Contract } from '../src/shared/ipc';
import { appContract } from '../src/shared/appContract';

/**
 * Reading zod schemas as data, for the audits that must cover every IPC channel without a
 * hand-written list: which fields a channel takes, and a valid sample input for it.
 */

/** Every feature contract, found the way features themselves are: by glob. */
export function discoverContracts(): Contract[] {
  const modules = import.meta.glob<Record<string, unknown>>('../src/features/*/contract.ts', {
    eager: true,
  });
  const found: Contract[] = [appContract as unknown as Contract];
  for (const [file, module] of Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))) {
    const contracts = Object.values(module).filter(isContract);
    if (contracts.length === 0) throw new Error(`${file} exports no contract`);
    found.push(...contracts);
  }
  return found;
}

function isContract(value: unknown): value is Contract {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Contract).feature === 'string' &&
    typeof (value as Contract).channels === 'object' &&
    typeof (value as Contract).events === 'object'
  );
}

interface Def {
  type: string;
  shape?: Record<string, z.ZodType>;
  innerType?: z.ZodType;
  element?: z.ZodType;
  options?: z.ZodType[];
  entries?: Record<string, string | number>;
  values?: unknown[];
  keyType?: z.ZodType;
  valueType?: z.ZodType;
  in?: z.ZodType;
  out?: z.ZodType;
  items?: z.ZodType[];
  left?: z.ZodType;
  right?: z.ZodType;
  getter?: () => z.ZodType;
  defaultValue?: unknown;
}

const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'readonly',
  'catch',
  'nonoptional',
]);

/** The schema inside optional / default / nullable / pipe wrappers. */
export function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (let guard = 0; guard < 20; guard++) {
    const def = defOf(current);
    if (WRAPPERS.has(def.type) && def.innerType) current = def.innerType;
    else if (def.type === 'pipe' && def.in) current = def.in;
    else if (def.type === 'lazy' && def.getter) current = def.getter();
    else break;
  }
  return current;
}

export const typeOf = (schema: z.ZodType): string => defOf(unwrap(schema)).type;

export interface Leaf {
  /** Keys from the input's root, `[]` for an array element. */
  path: string[];
  type: string;
  schema: z.ZodType;
}

/** Every leaf (string, number, ...) of a schema with the keys that lead to it. */
export function leaves(schema: z.ZodType, path: string[] = [], depth = 0): Leaf[] {
  if (depth > 12) return [];
  const inner = unwrap(schema);
  const def = defOf(inner);
  switch (def.type) {
    case 'object':
      return Object.entries(def.shape ?? {}).flatMap(([key, child]) =>
        leaves(child, [...path, key], depth + 1)
      );
    case 'array':
      return def.element ? leaves(def.element, [...path, '[]'], depth + 1) : [];
    case 'tuple':
      return (def.items ?? []).flatMap((item) => leaves(item, [...path, '[]'], depth + 1));
    case 'union':
      return (def.options ?? []).flatMap((option) => leaves(option, path, depth + 1));
    case 'intersection':
      return [def.left, def.right].flatMap((side) => (side ? leaves(side, path, depth + 1) : []));
    case 'record':
      return def.valueType ? leaves(def.valueType, [...path, '{}'], depth + 1) : [];
    default:
      return [{ path, type: def.type, schema: inner }];
  }
}

const STRING_CANDIDATES = [
  'sample',
  'a',
  'sample-1',
  'Sample name',
  '2026-10-03T12:00:00.000Z',
  '044F',
  '12345',
  'C:\\Sample\\file.txt',
  'https://example.com/',
  '{DOCUMENTS}/sample.txt',
  'sample.yaml',
  '#aabbcc',
];
const NUMBER_CANDIDATES = [1, 0, 10, 100, 1000, 0.5, -1, 90];

/** A value the schema accepts, or undefined when none of the candidates fits. */
export function sample(schema: z.ZodType, depth = 0): unknown {
  if (depth > 12) return undefined;
  const def = defOf(schema);
  const accepts = (value: unknown): boolean => schema.safeParse(value).success;
  switch (def.type) {
    case 'optional':
    case 'default':
    case 'prefault':
    case 'catch': {
      // Prefer a real value, so audits reach the handler's use of the field.
      const inner = def.innerType ? sample(def.innerType, depth + 1) : undefined;
      return inner !== undefined && accepts(inner) ? inner : undefined;
    }
    case 'nullable': {
      const inner = def.innerType ? sample(def.innerType, depth + 1) : undefined;
      return inner !== undefined && accepts(inner) ? inner : null;
    }
    case 'readonly':
    case 'nonoptional':
      return def.innerType ? sample(def.innerType, depth + 1) : undefined;
    case 'pipe':
      return def.in ? sample(def.in, depth + 1) : undefined;
    case 'lazy':
      return def.getter ? sample(def.getter(), depth + 1) : undefined;
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(def.shape ?? {})) {
        const value = sample(child, depth + 1);
        if (value !== undefined) out[key] = value;
      }
      if (accepts(out)) return out;
      // A refinement did not like the full object: try leaving optional keys out.
      const required: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(def.shape ?? {})) {
        if (!child.safeParse(undefined).success) required[key] = out[key];
      }
      if (accepts(required)) return required;
      for (const key of Object.keys(out)) {
        const one = { ...required, [key]: out[key] };
        if (accepts(one)) return one;
      }
      return out;
    }
    case 'array': {
      const element = def.element ? sample(def.element, depth + 1) : undefined;
      for (const candidate of [[element], [], [element, element]]) {
        if (!candidate.includes(undefined) && accepts(candidate)) return candidate;
      }
      return [];
    }
    case 'tuple':
      return (def.items ?? []).map((item) => sample(item, depth + 1));
    case 'record': {
      const value = def.valueType ? sample(def.valueType, depth + 1) : undefined;
      const key = def.keyType ? sample(def.keyType, depth + 1) : 'sample';
      const filled = value === undefined ? {} : { [String(key ?? 'sample')]: value };
      return accepts(filled) ? filled : {};
    }
    case 'union': {
      for (const option of def.options ?? []) {
        const value = sample(option, depth + 1);
        if (value !== undefined && value !== null && accepts(value)) return value;
      }
      return accepts(null) ? null : undefined;
    }
    case 'intersection': {
      const left = def.left ? sample(def.left, depth + 1) : {};
      const right = def.right ? sample(def.right, depth + 1) : {};
      return { ...(left as object), ...(right as object) };
    }
    case 'string':
    case 'template_literal':
      return STRING_CANDIDATES.find(accepts) ?? 'sample';
    case 'number':
    case 'int':
      return NUMBER_CANDIDATES.find(accepts) ?? 1;
    case 'bigint':
      return 1n;
    case 'boolean':
      return false;
    case 'enum':
      return Object.values(def.entries ?? {})[0];
    case 'literal':
      return (def.values ?? [])[0];
    case 'null':
      return null;
    case 'undefined':
    case 'void':
      return undefined;
    case 'date':
      return new Date('2026-10-03T12:00:00.000Z');
    case 'unknown':
    case 'any':
      return 'sample';
    default:
      return undefined;
  }
}

/** A copy of `input` with the value at `path` replaced (`[]` = first array element, `{}` = first record value). */
export function withValueAt(input: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path as [string, ...string[]];
  if (head === '[]') {
    const list = Array.isArray(input) && input.length > 0 ? [...input] : [undefined];
    list[0] = withValueAt(list[0], rest, value);
    return list;
  }
  if (head === '{}') {
    const record = { ...((input as Record<string, unknown> | undefined) ?? {}) };
    const key = Object.keys(record)[0] ?? 'sample';
    record[key] = withValueAt(record[key], rest, value);
    return record;
  }
  const object = { ...((input as Record<string, unknown> | undefined) ?? {}) };
  object[head] = withValueAt(object[head], rest, value);
  return object;
}
