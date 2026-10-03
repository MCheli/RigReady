import type { DefaultCombo } from './defaults';
import { comboId, type Combo, type CommandKind, type DiffEntry, type DiffModel } from './diff';

/**
 * What is really bound on one device: the defaults that apply to it plus exactly one
 * diff, applied the way DCS's applyDiffToCommands_ does (docs/research/dcs.md 1.4).
 */

/** A default command of one device, with its hash resolved as far as RigReady can. */
export interface DeviceCommand {
  kind: CommandKind;
  hash: string;
  combos: DefaultCombo[];
}

/** Where a binding comes from: DCS's defaults, the user's file, or a template shipped with DCS. */
export type BindingSource = 'default' | 'user' | 'template';

export interface EffectiveBinding {
  kind: CommandKind;
  hash: string;
  combo: Combo;
  source: BindingSource;
  /** A default axis whose curve or other filter settings the diff changed. */
  filterChanged: boolean;
  /** For defaults picked through DefaultAssignments.lua: "roll", "pitch", "thrust", ... */
  assignment?: string;
}

export interface RemovedDefault {
  kind: CommandKind;
  hash: string;
  combo: DefaultCombo;
}

export interface EffectiveResult {
  bindings: EffectiveBinding[];
  /** Defaults the diff cancels. */
  removed: RemovedDefault[];
  /** Diff entries whose hash matches no default command of this device. */
  unmatched: DiffEntry[];
}

interface Mention {
  added: Set<string>;
  removed: Set<string>;
}

export function applyDiff(
  commands: DeviceCommand[],
  diff: DiffModel | undefined,
  diffSource: 'user' | 'template'
): EffectiveResult {
  const result: EffectiveResult = { bindings: [], removed: [], unmatched: [] };
  const seen = new Set<string>();

  for (const kind of ['axis', 'key'] as const) {
    const entries = (diff?.entries ?? []).filter((e) => e.kind === kind);
    const byHash = new Map(entries.map((e) => [e.hash, e]));
    // Every combo that some entry adds or removes, and for which commands.
    const mentions = new Map<string, Mention>();
    const everywhere = new Set<string>();
    for (const entry of entries) {
      for (const combo of entry.added) {
        const m = mentions.get(comboId(combo)) ?? { added: new Set(), removed: new Set() };
        m.added.add(entry.hash);
        mentions.set(comboId(combo), m);
      }
      for (const combo of entry.removed) {
        const m = mentions.get(comboId(combo)) ?? { added: new Set(), removed: new Set() };
        m.removed.add(entry.hash);
        mentions.set(comboId(combo), m);
      }
      for (const combo of [...entry.added, ...entry.removed, ...entry.changed]) {
        everywhere.add(comboId(combo));
      }
    }

    for (const command of commands.filter((c) => c.kind === kind)) {
      if (seen.has(`${kind}:${command.hash}`)) continue;
      seen.add(`${kind}:${command.hash}`);
      let current: EffectiveBinding[] = command.combos.map((combo) => {
        const { assignment, ...plain } = combo;
        return {
          kind,
          hash: command.hash,
          combo: plain,
          source: 'default' as const,
          filterChanged: false,
          ...(assignment ? { assignment } : {}),
        };
      });

      if (entries.length > 0) {
        // A default that the diff gives to another command, without taking it away here,
        // stays ("updated" in DCS); otherwise everything the diff mentions is stripped.
        const updated = command.combos.some((combo) => {
          const mention = mentions.get(comboId(combo));
          return (
            mention !== undefined &&
            !mention.added.has(command.hash) &&
            !mention.removed.has(command.hash)
          );
        });
        if (!updated) current = current.filter((b) => !everywhere.has(comboId(b.combo)));
      }

      const own = byHash.get(command.hash);
      if (own) {
        const gone = new Set(own.removed.map(comboId));
        current = current.filter((b) => !gone.has(comboId(b.combo)));
        for (const combo of own.added) {
          if (current.some((b) => comboId(b.combo) === comboId(combo))) continue;
          current.push({
            kind,
            hash: command.hash,
            combo,
            source: diffSource,
            filterChanged: false,
          });
        }
        for (const combo of own.changed) {
          if (current.some((b) => comboId(b.combo) === comboId(combo))) continue;
          const original = command.combos.find((c) => comboId(c) === comboId(combo));
          current.push({
            kind,
            hash: command.hash,
            combo,
            source: 'default',
            filterChanged: true,
            ...(original?.assignment ? { assignment: original.assignment } : {}),
          });
        }
      }

      result.bindings.push(...current);
      const kept = new Set(current.map((b) => comboId(b.combo)));
      for (const combo of command.combos) {
        if (!kept.has(comboId(combo))) result.removed.push({ kind, hash: command.hash, combo });
      }
    }

    for (const entry of entries) {
      if (!seen.has(`${kind}:${entry.hash}`)) result.unmatched.push(entry);
    }
  }
  return result;
}
