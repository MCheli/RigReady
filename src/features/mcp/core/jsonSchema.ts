import { z } from 'zod';

/**
 * The JSON Schema (draft 2020-12) an assistant is shown for a channel's input, from the
 * zod schema the channel validates with. A tool's input must be an object schema, so a
 * channel that takes no input is shown an empty object, and an input the converter cannot
 * express is shown as a plain object with a note (and counted, so a test can say which).
 */

export type JsonSchema = Record<string, unknown>;

export const EMPTY_OBJECT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {},
  additionalProperties: false,
};

interface Def {
  type: string;
  innerType?: z.ZodType;
  options?: z.ZodType[];
}

const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** The schema under optional / default / nullable wrappers. */
function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (let guard = 0; guard < 20; guard++) {
    const def = defOf(current);
    if (
      (def.type === 'optional' ||
        def.type === 'default' ||
        def.type === 'prefault' ||
        def.type === 'nullable' ||
        def.type === 'readonly') &&
      def.innerType
    ) {
      current = def.innerType;
    } else break;
  }
  return current;
}

/** True for a channel that takes nothing: `noInput`, or anything that accepts undefined without an object inside. */
export function takesNoInput(schema: z.ZodType): boolean {
  if (!schema.safeParse(undefined).success) return false;
  return defOf(unwrap(schema)).type !== 'object';
}

/** True when the channel takes an object whose fields are all optional, so "no arguments" is also valid. */
export function takesOptionalObject(schema: z.ZodType): boolean {
  return schema.safeParse(undefined).success && defOf(unwrap(schema)).type === 'object';
}

export interface InputSchemaResult {
  schema: JsonSchema;
  /** Set when the zod schema could not be expressed and a plain object stands in. */
  problem?: string;
}

/** The input schema a tool declares for a channel. */
export function inputJsonSchema(schema: z.ZodType): InputSchemaResult {
  if (takesNoInput(schema)) return { schema: EMPTY_OBJECT_SCHEMA };
  const inner = unwrap(schema);
  try {
    const converted = z.toJSONSchema(inner, {
      target: 'draft-2020-12',
      io: 'input',
      unrepresentable: 'any',
    }) as JsonSchema;
    delete converted['$schema'];
    if (converted['type'] !== 'object') {
      return {
        schema: { type: 'object', properties: { value: converted }, required: ['value'] },
      };
    }
    return { schema: converted };
  } catch (e) {
    return {
      schema: { type: 'object', description: 'See the channel reference for the fields.' },
      problem: e instanceof Error ? e.message : String(e),
    };
  }
}

/** The output schema of a channel, as data for the channel reference. Undefined when it cannot be expressed. */
export function outputJsonSchema(schema: z.ZodType): JsonSchema | undefined {
  try {
    const converted = z.toJSONSchema(schema, {
      target: 'draft-2020-12',
      io: 'output',
      unrepresentable: 'any',
    }) as JsonSchema;
    delete converted['$schema'];
    return converted;
  } catch {
    // An output zod cannot describe as JSON Schema (a custom type): the reference shows none.
    return undefined;
  }
}

/** A JSON Schema is sound enough to hand out: an object with a type and nothing undefined inside. */
export function isSoundSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
  try {
    JSON.stringify(schema);
  } catch {
    // A cycle: not something a client can read.
    return false;
  }
  return 'type' in schema || 'anyOf' in schema || 'oneOf' in schema || '$ref' in schema;
}

/**
 * How a tool's arguments are handed to the channel: nothing for a channel that takes
 * nothing, the object otherwise, and the value inside `{ value }` for a channel whose input
 * is not an object.
 */
export function channelInputFrom(schema: z.ZodType, args: unknown): unknown {
  if (takesNoInput(schema)) return undefined;
  if (defOf(unwrap(schema)).type !== 'object' && args && typeof args === 'object') {
    return (args as Record<string, unknown>)['value'];
  }
  return args;
}
