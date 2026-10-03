import { createHash } from 'node:crypto';
import type { PathVariables } from '../../../core/pathVariables';

/**
 * Finds personal details in what a shared setup would contain (paths under the user's
 * folders, the Windows user and machine name, device serials and instance paths, audio
 * endpoint ids) and replaces the ones the user chose to remove.
 */

export type FindingKind =
  | 'path'
  | 'instancePath'
  | 'audioId'
  | 'serial'
  | 'machineName'
  | 'userName'
  | 'deviceId'
  | 'unchecked';

export type Decision = 'keep' | 'remove';

export interface Finding {
  id: string;
  kind: FindingKind;
  /** What was found, as the user would recognise it. */
  value: string;
  /** What removing it does. */
  removeText: string;
  /** Where it was found: "Setup", "DCS bindings / FA-18C_hornet/joystick/x.diff.lua". */
  where: string[];
  defaultAction: Decision;
}

export interface PrivacyContext {
  variables: PathVariables;
  /** Windows user names to look for. */
  users: string[];
  machine: string;
  /** Serial numbers of devices on this PC and in the setup. */
  serials: string[];
}

/** A path token in shared config files, expanded to the importer's folder on import. */
export const pathToken = (name: string, spelling: Spelling): string =>
  `%RIGREADY:${name}:${spelling}%`;
export type Spelling = 'bs' | 'dbs' | 'fs';
export const TOKEN = /%RIGREADY:([A-Z][A-Z0-9_]*):(bs|dbs|fs)%/g;

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const findingId = (kind: FindingKind, value: string): string =>
  createHash('sha256').update(`${kind}:${value.toLowerCase()}`).digest('hex').slice(0, 12);

interface Rule {
  kind: FindingKind;
  source: string;
  /** The finding's value for a match. */
  value(match: string): string;
  removeText: string;
  defaultAction: Decision;
  /** The text that replaces a removed match; `mode` is profile values or config file text. */
  replace(match: string, mode: Mode): string;
}

type Mode = 'profile' | 'file';

const INSTANCE =
  '(?:USB|HID|SWD|BTHENUM)\\\\{1,2}VID_[0-9A-F]{4}&PID_[0-9A-F]{4}[^\\s"\',;)}\\]]*' +
  '|\\\\{1,4}\\?\\\\{1,2}(?:hid|usb|display|swd)#[^\\s"\',;)\\]]+';
const AUDIO =
  '\\{0\\.0\\.[01]\\.00000000\\}\\.\\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\}';

function rules(ctx: PrivacyContext): Rule[] {
  const list: Rule[] = [];
  const bases = Object.entries(ctx.variables)
    .filter(([, base]) => base.length > 3)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [name, base] of bases) {
    const shown = base.replace(/\//g, '\\');
    const spellings: [Spelling, string][] = [
      ['dbs', shown.replace(/\\/g, '\\\\')],
      ['bs', shown],
      ['fs', shown.replace(/\\/g, '/')],
    ];
    for (const [spelling, written] of spellings) {
      list.push({
        kind: 'path',
        source: `${escape(written)}(?=[\\\\/"'\\s,;)\\]}]|$)`,
        value: () => shown,
        removeText: `Replaced with {${name}}, which means the same folder on the other PC`,
        defaultAction: 'remove',
        replace: (_m, mode) => (mode === 'profile' ? `{${name}}` : pathToken(name, spelling)),
      });
    }
  }
  list.push({
    kind: 'instancePath',
    source: INSTANCE,
    value: (m) => m,
    removeText: 'Removed (it only identifies the device on this PC)',
    defaultAction: 'remove',
    replace: () => 'removed',
  });
  list.push({
    kind: 'audioId',
    source: AUDIO,
    value: (m) => m,
    removeText: 'Removed (the audio check then matches by name only)',
    defaultAction: 'keep',
    replace: () => '',
  });
  for (const serial of [...new Set(ctx.serials)].filter((s) => s.length >= 4)) {
    list.push({
      kind: 'serial',
      source: `(?<![A-Za-z0-9])${escape(serial)}(?![A-Za-z0-9])`,
      value: () => serial,
      removeText: 'Removed',
      defaultAction: 'remove',
      replace: () => 'removed',
    });
  }
  if (ctx.machine.length >= 2) {
    list.push({
      kind: 'machineName',
      source: `(?<![A-Za-z0-9_-])${escape(ctx.machine)}(?![A-Za-z0-9_-])`,
      value: () => ctx.machine,
      removeText: 'Replaced with "my-pc"',
      defaultAction: 'remove',
      replace: () => 'my-pc',
    });
  }
  for (const user of [...new Set(ctx.users)].filter((u) => u.length >= 2)) {
    list.push({
      kind: 'userName',
      source: `(?<![A-Za-z0-9_])${escape(user)}(?![A-Za-z0-9_])`,
      value: () => user,
      removeText: 'Replaced with "user"',
      defaultAction: 'remove',
      replace: () => 'user',
    });
  }
  return list;
}

/**
 * One pass over a text with every rule at once: at each position the first rule that
 * matches wins, so a user name inside a path is part of the path, not a second finding.
 */
export class Scanner {
  private readonly rules: Rule[];
  private readonly regex: RegExp;
  readonly findings = new Map<string, Finding>();

  constructor(ctx: PrivacyContext) {
    this.rules = rules(ctx);
    this.regex = new RegExp(this.rules.map((r) => `(${r.source})`).join('|'), 'gi');
  }

  private record(rule: Rule, match: string, where: string): Finding {
    const value = rule.value(match);
    const id = findingId(rule.kind, value);
    let finding = this.findings.get(id);
    if (!finding) {
      finding = {
        id,
        kind: rule.kind,
        value,
        removeText: rule.removeText,
        where: [],
        defaultAction: rule.defaultAction,
      };
      this.findings.set(id, finding);
    }
    if (!finding.where.includes(where)) finding.where.push(where);
    return finding;
  }

  /** Records what the text contains and returns it with the removed findings replaced. */
  transform(
    text: string,
    where: string,
    mode: Mode,
    decide: (finding: Finding) => Decision
  ): string {
    if (this.rules.length === 0) return text;
    return text.replace(this.regex, (match, ...groups: unknown[]) => {
      const index = groups.findIndex((g, i) => i < this.rules.length && g !== undefined);
      const rule = this.rules[index]!;
      const finding = this.record(rule, match, where);
      return decide(finding) === 'remove' ? rule.replace(match, mode) : match;
    });
  }

  /** A finding that is not in any text (a device id in a file name, a binary file). */
  add(finding: Omit<Finding, 'id' | 'where'>, where: string): Finding {
    const id = findingId(finding.kind, finding.value);
    const existing = this.findings.get(id) ?? { ...finding, id, where: [] };
    if (!existing.where.includes(where)) existing.where.push(where);
    this.findings.set(id, existing);
    return existing;
  }

  list(): Finding[] {
    const order: FindingKind[] = [
      'userName',
      'machineName',
      'serial',
      'instancePath',
      'path',
      'audioId',
      'deviceId',
      'unchecked',
    ];
    return [...this.findings.values()].sort(
      (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.value.localeCompare(b.value)
    );
  }
}

const IDENTITY_KEYS = new Set(['serial', 'instanceId', 'instancePath']);

/**
 * Applies the scanner to every string of a value (a profile). A device identity
 * parameter (serial, instance id) that is removed is dropped rather than left as
 * "removed", so the check falls back to matching by vendor and product id.
 */
export function transformValue(
  value: unknown,
  scanner: Scanner,
  where: (path: string[]) => string,
  decide: (finding: Finding) => Decision,
  trail: string[] = []
): unknown {
  if (typeof value === 'string') return scanner.transform(value, where(trail), 'profile', decide);
  if (Array.isArray(value)) {
    return value.map((v, i) => transformValue(v, scanner, where, decide, [...trail, String(i)]));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      const next = transformValue(v, scanner, where, decide, [...trail, key]);
      if (IDENTITY_KEYS.has(key) && typeof v === 'string' && next !== v) continue;
      out[key] = next;
    }
    return out;
  }
  return value;
}

/** Turns the tokens of a shared config file into this PC's folders. Unknown variables stay as tokens. */
export function expandTokens(text: string, variables: PathVariables): string {
  return text.replace(TOKEN, (token, name: string, spelling: Spelling) => {
    const base = variables[name];
    if (base === undefined) return token;
    const shown = base.replace(/\//g, '\\');
    if (spelling === 'dbs') return shown.replace(/\\/g, '\\\\');
    if (spelling === 'fs') return shown.replace(/\\/g, '/');
    return shown;
  });
}
