import { LuaDocument, parseLuaData, writeLuaDocument } from '../../../core/lua/data';
import { err, ok, type Result } from '../../../core/result';
import type { AircraftState, DcsBindings, DeviceState } from './bindings';
import { PlanBuilder, executePlan, planView, type Applied, type ChangePlan } from './changes';
import {
  DEFAULT_FILTER,
  dropCombo,
  hasCombo,
  isEmptyDiff,
  newDiffDocument,
  putCombo,
  readDiff,
  sameCombo,
  sameFilter,
  type AxisFilter,
  type Combo,
  type CommandKind,
} from './diff';
import { applyDiff } from './effective';
import type { BindingOp } from './model';
import { comboLabel, deviceHasInput } from './names';

/**
 * Edits to bindings, as minimal changes to the diff files (docs/research/dcs.md 1.4):
 * a default is cancelled with a `removed` entry, a user binding by deleting its `added`
 * entry, and binding an input takes it away from whatever else it was bound to on
 * that device, exactly as DCS's own controls screen does.
 */

export type { BindingOp };

interface Work {
  device: DeviceState;
  doc: LuaDocument;
  lines: string[];
}

function splitCommandId(id: string): { kind: CommandKind; hash: string } | undefined {
  const at = id.indexOf(':');
  const kind = id.slice(0, at);
  if (at < 0 || (kind !== 'key' && kind !== 'axis')) return undefined;
  return { kind, hash: id.slice(at + 1) };
}

function filterSummary(filter: AxisFilter): string {
  const parts: string[] = [];
  if (filter.curvature.length > 1)
    parts.push(`custom curve with ${filter.curvature.length} points`);
  else if ((filter.curvature[0] ?? 0) !== 0) parts.push(`curve ${filter.curvature[0]}`);
  if (filter.deadzone !== 0) parts.push(`deadzone ${filter.deadzone}`);
  if (filter.saturationX !== 1) parts.push(`saturation X ${filter.saturationX}`);
  if (filter.saturationY !== 1) parts.push(`saturation Y ${filter.saturationY}`);
  if (filter.invert) parts.push('inverted');
  if (filter.slider) parts.push('slider');
  return parts.length > 0 ? parts.join(', ') : 'DCS defaults';
}

class AircraftEditor {
  private readonly work = new Map<string, Work>();

  constructor(
    private readonly state: AircraftState,
    private readonly notes: PlanBuilder
  ) {}

  private workFor(deviceId: string): Result<Work> {
    const existing = this.work.get(deviceId);
    if (existing) return ok(existing);
    const device = this.state.devices.find((d) => d.id === deviceId);
    if (!device) return err('dcs.device.unknown', `There is no device "${deviceId}" here.`);
    if (device.userError) {
      return err(
        'dcs.file.unreadable',
        `${device.userPath} could not be read (${device.userError}), so RigReady will not change it.`
      );
    }
    let doc: LuaDocument;
    const lines: string[] = [];
    if (device.userText !== undefined) {
      const parsed = parseLuaData(device.userText);
      if (!parsed.ok) return parsed;
      doc = parsed.value;
    } else if (device.templateText !== undefined) {
      // DCS stops using its template the moment a user file exists, so start from it.
      const parsed = parseLuaData(device.templateText);
      doc = parsed.ok ? parsed.value : newDiffDocument();
      if (parsed.ok) {
        lines.push(
          'Starts from the bindings DCS ships for this device, which DCS stops using once you have your own file'
        );
      }
    } else {
      doc = newDiffDocument();
    }
    const work = { device, doc, lines };
    this.work.set(deviceId, work);
    return ok(work);
  }

  private name(kind: CommandKind, hash: string): string {
    return this.state.commands.get(`${kind}:${hash}`)?.name ?? hash;
  }

  private defaultCombo(
    work: Work,
    kind: CommandKind,
    hash: string,
    combo: Combo
  ): Combo | undefined {
    return work.device.commands
      .find((c) => c.kind === kind && c.hash === hash)
      ?.combos.find((c) => sameCombo(c, combo));
  }

  private editable(kind: CommandKind, hash: string): boolean {
    return this.state.commands.get(`${kind}:${hash}`)?.editable ?? true;
  }

  private unbind(work: Work, kind: CommandKind, hash: string, combo: Combo): boolean {
    const name = this.name(kind, hash);
    const label = comboLabel(combo);
    let changed = false;
    if (dropCombo(work.doc, kind, hash, 'added', combo)) {
      work.lines.push(`${name}: remove ${label}`);
      changed = true;
    }
    if (dropCombo(work.doc, kind, hash, 'changed', combo)) changed = true;
    if (
      this.defaultCombo(work, kind, hash, combo) &&
      !hasCombo(work.doc, kind, hash, 'removed', combo)
    ) {
      putCombo(work.doc, kind, hash, name, 'removed', {
        key: combo.key,
        reformers: combo.reformers,
      });
      work.lines.push(`${name}: cancel DCS's default ${label}`);
      changed = true;
    }
    return changed;
  }

  private setFilter(
    work: Work,
    kind: CommandKind,
    hash: string,
    combo: Combo,
    filter: AxisFilter
  ): Result<void> {
    const name = this.name(kind, hash);
    const plain = { key: combo.key, reformers: combo.reformers };
    if (hasCombo(work.doc, kind, hash, 'added', plain)) {
      putCombo(work.doc, kind, hash, name, 'added', { ...plain, filter });
    } else {
      const original = this.defaultCombo(work, kind, hash, plain);
      if (!original || hasCombo(work.doc, kind, hash, 'removed', plain)) {
        return err('dcs.notBound', `${comboLabel(plain)} is not bound to ${name}.`);
      }
      if (sameFilter(filter, original.filter ?? DEFAULT_FILTER)) {
        dropCombo(work.doc, kind, hash, 'changed', plain);
      } else {
        putCombo(work.doc, kind, hash, name, 'changed', { ...plain, filter });
      }
    }
    work.lines.push(`${name}: set ${comboLabel(plain)} to ${filterSummary(filter)}`);
    return ok(undefined);
  }

  private current(work: Work): ReturnType<typeof applyDiff> {
    return applyDiff(work.device.commands, readDiff(work.doc), 'user');
  }

  apply(op: BindingOp): Result<void> {
    const found = this.workFor(op.deviceId);
    if (!found.ok) return found;
    const work = found.value;

    if (op.op === 'clearDevice') {
      const now = this.current(work);
      let skipped = 0;
      const caps = work.device.input;
      for (const binding of now.bindings) {
        // A default on a control the device does not have can never fire: nothing to clear.
        if (caps && !deviceHasInput(caps, binding.combo.key)) continue;
        if (!this.editable(binding.kind, binding.hash)) skipped++;
        else this.unbind(work, binding.kind, binding.hash, binding.combo);
      }
      for (const entry of now.unmatched) {
        for (const combo of [...entry.added]) this.unbind(work, entry.kind, entry.hash, combo);
      }
      if (skipped > 0) this.cannotWrite(skipped, work.device.name);
      return ok(undefined);
    }

    const id = splitCommandId(op.commandId);
    if (!id) return err('dcs.command.unknown', `"${op.commandId}" is not an action.`);
    const { kind, hash } = id;
    const combo: Combo = { key: op.combo.key, reformers: op.combo.reformers };
    if (!this.editable(kind, hash)) {
      return err(
        'dcs.command.unknownNumber',
        `RigReady does not know the number DCS uses internally for "${this.name(kind, hash)}", so it cannot write a binding for it yet. Bind it once in DCS's own controls screen and RigReady will learn it from the file.`
      );
    }

    if (op.op === 'unbind') {
      if (!this.unbind(work, kind, hash, combo)) {
        return err(
          'dcs.notBound',
          `${comboLabel(combo)} is not bound to ${this.name(kind, hash)} on ${work.device.name}.`
        );
      }
      return ok(undefined);
    }

    if (op.op === 'setFilter') return this.setFilter(work, kind, hash, combo, op.filter);

    // bind: take the input away from everything else it does on this device first.
    const now = this.current(work);
    for (const other of now.bindings) {
      if (!sameCombo(other.combo, combo) || (other.kind === kind && other.hash === hash)) continue;
      if (!this.editable(other.kind, other.hash)) {
        this.cannotWrite(1, work.device.name);
        continue;
      }
      this.unbind(work, other.kind, other.hash, other.combo);
    }
    for (const entry of now.unmatched) {
      if (entry.kind === kind && entry.hash === hash) continue;
      if (entry.added.some((c) => sameCombo(c, combo))) {
        this.unbind(work, entry.kind, entry.hash, combo);
      }
    }
    const name = this.name(kind, hash);
    const label = comboLabel(combo);
    const original = this.defaultCombo(work, kind, hash, combo);
    // A `removed` entry for something DCS no longer binds by default is just stale.
    const cancelled = dropCombo(work.doc, kind, hash, 'removed', combo);
    if (cancelled && original) {
      work.lines.push(`${name}: restore DCS's default ${label}`);
      if (op.combo.filter && !sameFilter(op.combo.filter, original.filter ?? DEFAULT_FILTER)) {
        return this.setFilter(work, kind, hash, combo, op.combo.filter);
      }
    } else if (original || hasCombo(work.doc, kind, hash, 'added', combo)) {
      // Already bound here; only the curve may be new.
      if (op.combo.filter) return this.setFilter(work, kind, hash, combo, op.combo.filter);
    } else {
      putCombo(work.doc, kind, hash, name, 'added', {
        ...combo,
        ...(op.combo.filter ? { filter: op.combo.filter } : {}),
      });
      work.lines.push(
        `${name}: bind ${label}${op.combo.filter && !sameFilter(op.combo.filter, DEFAULT_FILTER) ? ` (${filterSummary(op.combo.filter)})` : ''}`
      );
    }
    return ok(undefined);
  }

  private cannotWrite(count: number, deviceName: string): void {
    this.notes.note(
      `${count === 1 ? 'One default binding' : `${count} default bindings`} on ${deviceName} could not be cancelled because RigReady does not know DCS's internal number for the action yet.`
    );
  }

  /** Adds the resulting file changes to the plan. */
  finish(builder: PlanBuilder): void {
    for (const work of this.work.values()) {
      const { device } = work;
      const title = `${device.name} · ${this.state.profile.name}`;
      const before = device.userText ?? null;
      if (isEmptyDiff(work.doc)) {
        if (before !== null) {
          builder.remove(device.userPath, before, {
            title,
            lines: [
              ...work.lines,
              'Nothing is left in this file, so it is deleted, as DCS does: the device is back on its defaults',
            ],
          });
        }
        continue;
      }
      builder.write(device.userPath, before, writeLuaDocument(work.doc), {
        title,
        lines: work.lines,
      });
    }
  }
}

interface Prepared {
  builder: PlanBuilder;
  summary: string;
  dcsRunning: boolean;
}

async function prepare(
  bindings: DcsBindings,
  ops: BindingOp[],
  summary: string | undefined
): Promise<Result<Prepared>> {
  const builder = new PlanBuilder();
  const names: string[] = [];
  const byAircraft = new Map<string, BindingOp[]>();
  for (const op of ops) byAircraft.set(op.aircraft, [...(byAircraft.get(op.aircraft) ?? []), op]);
  for (const [aircraft, list] of byAircraft) {
    const state = await bindings.state(aircraft);
    if (!state.ok) return state;
    names.push(state.value.profile.name);
    const editor = new AircraftEditor(state.value, builder);
    for (const op of list) {
      const applied = editor.apply(op);
      if (!applied.ok) return applied;
    }
    editor.finish(builder);
  }
  const changes = builder.steps.reduce((n, step) => n + step.lines.length, 0);
  return ok({
    builder,
    summary:
      summary ??
      `Change ${changes} ${changes === 1 ? 'binding' : 'bindings'} for ${names.join(', ')}`,
    dcsRunning: await bindings.dcsRunning(),
  });
}

/** What a list of edits would write, without writing it. */
export async function planEdits(
  bindings: DcsBindings,
  ops: BindingOp[],
  summary?: string
): Promise<Result<ChangePlan>> {
  const prepared = await prepare(bindings, ops, summary);
  if (!prepared.ok) return prepared;
  const { builder, dcsRunning } = prepared.value;
  return ok(planView(prepared.value.summary, builder, dcsRunning));
}

/** Writes a list of edits as one undoable change. Refuses while DCS is running. */
export async function applyEdits(
  bindings: DcsBindings,
  ops: BindingOp[],
  summary?: string
): Promise<Result<Applied>> {
  const prepared = await prepare(bindings, ops, summary);
  if (!prepared.ok) return prepared;
  const { builder, dcsRunning } = prepared.value;
  return executePlan(
    bindings.ctx.ports,
    prepared.value.summary,
    builder,
    dcsRunning,
    bindings.ctx.changed
  );
}

/** The edits that cancel every unwanted default binding of the given aircraft. */
export async function cleanupOps(
  bindings: DcsBindings,
  aircraftIds: string[],
  only?: Set<string>
): Promise<Result<BindingOp[]>> {
  const ops: BindingOp[] = [];
  for (const aircraft of aircraftIds) {
    const view = await bindings.view(aircraft);
    if (!view.ok) return view;
    for (const unwanted of view.value.problems.unwantedDefaults) {
      if (only && !only.has(unwanted.id)) continue;
      const command = view.value.commands.find((c) => c.id === unwanted.commandId);
      if (!command?.editable) continue;
      ops.push({
        op: 'unbind',
        aircraft,
        deviceId: unwanted.deviceId,
        commandId: unwanted.commandId,
        combo: { key: unwanted.combo.key, reformers: unwanted.combo.reformers },
      });
    }
  }
  return ok(ops);
}
