/**
 * Turns a check or fix type's JSON Schema (made from its zod params schema in main) into
 * the fields of a form. Every leaf gets a control: simple values get their own input,
 * anything structured (a monitor layout) gets a JSON text box, so nothing is uneditable.
 */

export type FieldKind =
  'text' | 'longText' | 'number' | 'boolean' | 'choice' | 'list' | 'numberList' | 'json';

export interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** For choice. */
  options?: string[];
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
};

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
      return { ...base, kind: 'choice' as const, options: (prop['enum'] as unknown[]).map(String) };
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
      if (items['type'] === 'string') return { ...base, kind: 'list' as const };
      if (items['type'] === 'number' || items['type'] === 'integer') {
        return { ...base, kind: 'numberList' as const };
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
