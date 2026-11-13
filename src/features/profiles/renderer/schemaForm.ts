/**
 * Turns a check or fix type's JSON Schema (made from its zod params schema in main) into
 * the fields of a form. Every leaf gets a control: simple values get their own input, a
 * closed list gets tick boxes, a small group of values (a width and a height) gets its own
 * inputs. Anything else structured falls back to a JSON text box so nothing is uneditable;
 * a type whose field would land there declares a picker instead (see pickerForm), and a
 * test keeps it so that no visible field of a registered type is JSON.
 */

export type FieldKind =
  | 'text'
  | 'longText'
  | 'number'
  | 'boolean'
  | 'choice'
  | 'multiChoice'
  | 'list'
  | 'numberList'
  | 'group'
  | 'json';

export interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** For choice and multiChoice. */
  options?: string[];
  /** What each option is called, when the type says so (JSON Schema "x-labels"). */
  optionLabels?: Record<string, string>;
  /** For group: the schema of the values inside it. */
  schema?: Record<string, unknown>;
  default?: unknown;
  min?: number;
  max?: number;
  integer?: boolean;
  pattern?: string;
  /** A path: offer a Browse button. */
  browse?: 'file' | 'folder' | 'program';
  hint?: string;
}

type Schema = Record<string, unknown>;

const LABELS: Record<string, string> = {
  exe: 'Program',
  args: 'Arguments',
  cwd: 'Working folder',
  vendorId: 'Vendor id (VID)',
  productId: 'Product id (PID)',
  serial: 'Serial number',
  instanceId: 'USB instance path',
  installDir: 'Install folder',
  waitFor: 'Wait for this program name',
  timeoutMs: 'Wait up to (ms)',
  timeoutSeconds: 'Timeout (seconds)',
  successExitCodes: 'Exit codes that mean success',
  keyPath: 'Key',
  stopOnStandDown: 'Close at Stand down',
  forceClose: 'Force it closed if it does not close',
  requiresConfirmation: 'Ask me before every run',
  waitForCompletion: 'Wait until it finishes',
  hidden: 'No console window',
  verifiedVersion: 'Verified version',
  text: 'Instructions',
};

const HINTS: Record<string, string> = {
  path: 'A full path, or one starting with a variable such as {DCS_USER}/Config/options.lua',
  exe: 'A full path, or one starting with a variable such as {PROGRAM_FILES_X86}/...',
  args: 'Each argument on its own line; nothing is ever joined into a command line',
  pattern: 'Folders only, e.g. *.diff.lua',
  name: 'The program or service name, e.g. TrackIR5.exe',
  stopOnStandDown:
    'On: always closed. Off: never. Until you set it, only an app RigReady started is closed.',
  text: 'Plain text with - lists, 1. steps, **bold**, `code` and [links](https://...)',
  keyPath: 'Lua: options.graphics.multiMonitorSetup · INI: Section.key · JSON: a.b.c',
};

const BROWSE: Record<string, Field['browse']> = {
  path: 'file',
  exe: 'program',
  cwd: 'folder',
  installDir: 'folder',
};

/** The names a type gives its options, when it gives any. */
function optionLabels(prop: Schema): { optionLabels?: Record<string, string> } {
  const labels = prop['x-labels'];
  if (!labels || typeof labels !== 'object') return {};
  const named = Object.entries(labels as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  );
  return named.length > 0 ? { optionLabels: Object.fromEntries(named) } : {};
}

/** What an option is called in the form: its name when the type gave one, else itself. */
export function optionTitle(field: Pick<Field, 'optionLabels'>, option: string): string {
  return field.optionLabels?.[option] ?? option;
}

const SIMPLE = new Set<FieldKind>(['text', 'number', 'boolean', 'choice']);

export function humanize(key: string): string {
  if (LABELS[key]) return LABELS[key]!;
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The schema of one property, with "anyOf [x, null]" style wrappers taken off. */
function unwrap(schema: Schema): Schema {
  const anyOf = schema['anyOf'] as Schema[] | undefined;
  if (Array.isArray(anyOf)) {
    const real = anyOf.filter((s) => s['type'] !== 'null' && s['not'] === undefined);
    if (real.length === 1)
      return {
        ...real[0],
        ...(schema['default'] !== undefined ? { default: schema['default'] } : {}),
      };
  }
  return schema;
}

export function fieldsOf(schema: Schema | undefined): Field[] {
  const properties = (schema?.['properties'] ?? {}) as Record<string, Schema>;
  const required = new Set((schema?.['required'] ?? []) as string[]);
  return Object.entries(properties).map(([key, raw]) => {
    const prop = unwrap(raw);
    const base = {
      key,
      label: humanize(key),
      required: required.has(key) && prop['default'] === undefined,
      ...(prop['default'] !== undefined ? { default: prop['default'] } : {}),
      ...(HINTS[key] ? { hint: HINTS[key] } : {}),
    };
    const type = prop['type'];
    if (Array.isArray(prop['enum'])) {
      return {
        ...base,
        kind: 'choice' as const,
        options: (prop['enum'] as unknown[]).map(String),
        ...optionLabels(prop),
      };
    }
    if (type === 'string') {
      return {
        ...base,
        kind: key === 'text' ? ('longText' as const) : ('text' as const),
        ...(typeof prop['pattern'] === 'string' ? { pattern: prop['pattern'] } : {}),
        ...(BROWSE[key] ? { browse: BROWSE[key] } : {}),
      };
    }
    if (type === 'number' || type === 'integer') {
      return {
        ...base,
        kind: 'number' as const,
        integer: type === 'integer',
        ...(typeof prop['minimum'] === 'number' ? { min: prop['minimum'] } : {}),
        ...(typeof prop['maximum'] === 'number' ? { max: prop['maximum'] } : {}),
      };
    }
    if (type === 'boolean') return { ...base, kind: 'boolean' as const };
    if (type === 'array') {
      const items = unwrap((prop['items'] ?? {}) as Schema);
      // A closed list is ticked, never typed.
      if (Array.isArray(items['enum'])) {
        return {
          ...base,
          kind: 'multiChoice' as const,
          options: (items['enum'] as unknown[]).map(String),
          ...optionLabels(items),
        };
      }
      if (items['type'] === 'string') return { ...base, kind: 'list' as const };
      if (items['type'] === 'number' || items['type'] === 'integer') {
        return { ...base, kind: 'numberList' as const };
      }
    }
    // A few plain values together (a width and a height): each gets its own input.
    if (type === 'object') {
      const inner = fieldsOf(prop);
      if (inner.length > 0 && inner.every((f) => SIMPLE.has(f.kind))) {
        return { ...base, kind: 'group' as const, schema: prop };
      }
    }
    return { ...base, kind: 'json' as const };
  });
}

/** Params with every default filled in, for a newly added item. */
export function defaultsOf(schema: Schema | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fieldsOf(schema)) {
    if (field.default !== undefined) out[field.key] = plain(field.default);
  }
  return out;
}

/** A deep copy as plain data. Unlike structuredClone it accepts Vue's reactive proxies. */
export function plain<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
