import {
  AXIS_HASH_FIELDS,
  KEY_HASH_FIELDS,
  fieldText,
  type CommandFields,
  type DefaultCommand,
} from './defaults';
import type { CommandKind } from './diff';
import { ENGINE_COMMAND_IDS } from './engineIdTable';

/**
 * The numbers of DCS's built-in engine commands (iCommandPlanePitch = 2001, ...).
 * They exist in no Lua file (docs/research/dcs.md 1.4), so RigReady ships the ones it
 * has seen and learns more from binding files: a diff entry stores the command's hash
 * (which contains the numbers) next to its name, and the defaults give the same name
 * next to the engine command names.
 */

const VALUE = '(nil|true|false|-?\\d[\\d.e+-]*)';
const KEY_HASH = new RegExp(
  `^${KEY_HASH_FIELDS.map(([, prefix]) => `${prefix}${VALUE}`).join('')}$`
);
const AXIS_HASH = new RegExp(
  `^${AXIS_HASH_FIELDS.map(([, prefix]) => `${prefix}${VALUE}`).join('')}$`
);

/** The field texts inside a hash from a file, in hash order. Undefined when it is not a hash. */
export function parseHash(kind: CommandKind, hash: string): string[] | undefined {
  const match = (kind === 'key' ? KEY_HASH : AXIS_HASH).exec(hash);
  return match ? match.slice(1) : undefined;
}

export interface NamedHash {
  kind: CommandKind;
  hash: string;
  name: string;
}

export class EngineIds {
  private readonly ids = new Map<string, number>(Object.entries(ENGINE_COMMAND_IDS));

  readonly resolve = (name: string): number | undefined => this.ids.get(name);

  get size(): number {
    return this.ids.size;
  }

  /** Every known id, for tests and for building the shipped table. */
  entries(): [string, number][] {
    return [...this.ids.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }

  /**
   * Learns engine command numbers by matching named hashes from binding files against
   * default commands of the same name. Only unambiguous matches are used. Returns how
   * many numbers were learned.
   */
  learn(commands: DefaultCommand[], entries: NamedHash[]): number {
    const byName = new Map<string, DefaultCommand[]>();
    for (const command of commands) {
      const key = `${command.kind}:${command.name.trim()}`;
      byName.set(key, [...(byName.get(key) ?? []), command]);
    }
    let learned = 0;
    for (let round = 0; round < 8; round++) {
      let progress = false;
      for (const entry of entries) {
        const texts = parseHash(entry.kind, entry.hash);
        if (!texts) continue;
        const fields = entry.kind === 'key' ? KEY_HASH_FIELDS : AXIS_HASH_FIELDS;
        const found = new Map<string, Map<string, number>>();
        for (const command of byName.get(`${entry.kind}:${entry.name.trim()}`) ?? []) {
          const bindings = this.unify(command.fields, fields, texts);
          if (bindings) found.set(JSON.stringify([...bindings.entries()].sort()), bindings);
        }
        if (found.size !== 1) continue;
        for (const [name, id] of [...found.values()][0]!) {
          if (this.ids.has(name)) continue;
          this.ids.set(name, id);
          learned++;
          progress = true;
        }
      }
      if (!progress) break;
    }
    return learned;
  }

  /** The engine names a hash would pin down if it belongs to this command; undefined when it cannot. */
  private unify(
    command: CommandFields,
    fields: readonly (readonly [string, string])[],
    texts: string[]
  ): Map<string, number> | undefined {
    const bindings = new Map<string, number>();
    for (let index = 0; index < fields.length; index++) {
      const value = command[fields[index]![0] as keyof CommandFields];
      const text = texts[index]!;
      if (typeof value === 'string') {
        const known = this.ids.get(value) ?? bindings.get(value);
        if (known !== undefined) {
          if (fieldText(known) !== text) return undefined;
        } else {
          if (!/^-?\d+$/.test(text)) return undefined;
          bindings.set(value, Number(text));
        }
      } else if (fieldText(value) !== text) {
        return undefined;
      }
    }
    return bindings;
  }
}
