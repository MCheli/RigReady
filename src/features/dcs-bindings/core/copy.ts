import { ok, type Result } from '../../../core/result';
import type { DcsBindings } from './bindings';
import { comboId } from './diff';
import type { BindingOp } from './edits';
import type { AircraftView, CommandView, CopyPreview, CopyProposal } from './model';

export type { CopyPreview, CopyProposal };

/**
 * Copying common controls from one aircraft to another (the owner's "common
 * keybindings": trigger, trim, view, comms). Actions are matched by DCS's command id
 * when both aircraft have the same one (view and zoom commands are engine commands
 * shared by every aircraft), otherwise by what the action is, through a short list of
 * common controls.
 */

interface Concept {
  id: string;
  /** Matched against English action names of any aircraft. */
  patterns: RegExp[];
  /** A "closest action" match that the user must opt into. */
  loose?: boolean;
}

const CONCEPTS: Concept[] = [
  { id: 'pitch', patterns: [/^Pitch$/, /Cyclic Pitch$/] },
  { id: 'roll', patterns: [/^Roll$/, /Cyclic Roll$/] },
  { id: 'rudder', patterns: [/^Rudder$/, /^Flight Control Rudder$/] },
  { id: 'thrust', patterns: [/^Thrust$/, /^Flight Control Collective$/, /^Throttle$/] },
  { id: 'wheel-brake-left', patterns: [/^Wheel Brake Left$/] },
  { id: 'wheel-brake-right', patterns: [/^Wheel Brake Right$/] },
  { id: 'wheel-brake', patterns: [/^Wheel Brake$/, /^Wheel Brake - ON\/OFF$/] },
  { id: 'trim-nose-down', patterns: [/Trim.*(PUSH|DESCEND|Nose Down)/i] },
  { id: 'trim-nose-up', patterns: [/Trim.*(PULL|CLIMB|Nose Up)/i] },
  { id: 'trim-left', patterns: [/Trim.*LEFT/i] },
  { id: 'trim-right', patterns: [/Trim.*RIGHT/i] },
  { id: 'view-center', patterns: [/^View Center$/, /^Center View$/] },
  { id: 'zoom-in', patterns: [/^Zoom in slow$/] },
  { id: 'zoom-out', patterns: [/^Zoom out slow$/] },
  { id: 'zoom-axis', patterns: [/^Zoom View$/] },
  {
    id: 'radio',
    patterns: [
      /^COMM Switch - COMM 1 \(call radio menu\)$/,
      /^Pilot's radio trigger RADIO/,
      /^Communication menu$/,
    ],
  },
  {
    id: 'trigger',
    patterns: [
      /^Gun Trigger - SECOND DETENT/,
      /^Pilot weapon release\/Machinegun fire$/,
      /^Weapon Fire$/,
    ],
  },
  { id: 'kneeboard', patterns: [/^Kneeboard ON\/OFF$/i] },
  // The Huey has no trim hat; its force trim button is the closest thing.
  { id: 'trim', patterns: [/^Trimmer Switch - /, /^Pilot Trimmer$/, /^Trim /], loose: true },
];

function conceptsOf(name: string): Concept[] {
  return CONCEPTS.filter((c) => c.patterns.some((p) => p.test(name)));
}

function findTarget(
  source: CommandView,
  target: AircraftView
): { command: CommandView; match: CopyProposal['match'] } | undefined {
  const same = target.commands.find((c) => c.id === source.id && !c.unmatched);
  if (same) return { command: same, match: 'same' };
  for (const concept of conceptsOf(source.name)) {
    const candidate = target.commands.find(
      (c) =>
        c.kind === source.kind &&
        c.editable &&
        !c.unmatched &&
        concept.patterns.some((p) => p.test(c.name))
    );
    if (candidate) return { command: candidate, match: concept.loose ? 'closest' : 'equivalent' };
  }
  return undefined;
}

/** What copying the user's bindings of the chosen devices from one aircraft to another would do. */
export async function previewCopy(
  bindings: DcsBindings,
  from: string,
  to: string,
  deviceIds: string[]
): Promise<Result<CopyPreview>> {
  const source = await bindings.view(from);
  if (!source.ok) return source;
  const target = await bindings.view(to);
  if (!target.ok) return target;
  const sourceCommands = new Map(source.value.commands.map((c) => [c.id, c]));
  const targetCommands = new Map(target.value.commands.map((c) => [c.id, c]));
  const proposals: CopyProposal[] = [];
  const unmatched: CopyPreview['unmatched'] = [];

  for (const deviceId of deviceIds) {
    const device = source.value.devices.find((d) => d.id === deviceId);
    const targetDevice = target.value.devices.find((d) => d.id === deviceId);
    if (!device || !targetDevice) continue;
    for (const binding of device.bindings) {
      // Only what the user set up: their own bindings and defaults whose curve they changed.
      if (binding.inert || (binding.source === 'default' && !binding.filterChanged)) continue;
      const command = sourceCommands.get(binding.commandId);
      if (!command) continue;
      const found = findTarget(command, target.value);
      if (!found) {
        unmatched.push({
          deviceName: device.givenName ?? device.name,
          label: binding.label,
          name: command.name,
        });
        continue;
      }
      const onInput = targetDevice.bindings.filter(
        (b) => !b.inert && comboId(b.combo) === comboId(binding.combo)
      );
      const already = onInput.some(
        (b) =>
          b.commandId === found.command.id &&
          JSON.stringify(b.combo.filter ?? null) === JSON.stringify(binding.combo.filter ?? null)
      );
      proposals.push({
        id: `${deviceId}|${binding.commandId}|${comboId(binding.combo)}`,
        deviceId,
        deviceName: device.givenName ?? device.name,
        combo: binding.combo,
        label: binding.label,
        from: { commandId: command.id, name: command.name },
        to: { commandId: found.command.id, name: found.command.name },
        match: found.match,
        replaces: onInput
          .filter((b) => b.commandId !== found.command.id)
          .map((b) => targetCommands.get(b.commandId)?.name ?? b.commandId),
        already,
        selected: !already && found.match !== 'closest',
      });
    }
  }
  return ok({
    from: source.value.aircraft.name,
    to: target.value.aircraft.name,
    proposals,
    unmatched,
  });
}

/** The edits for the proposals the user ticked. */
export function copyOps(preview: CopyPreview, to: string, selected: string[]): BindingOp[] {
  const wanted = new Set(selected);
  return preview.proposals
    .filter((p) => wanted.has(p.id) && !p.already)
    .map((p) => ({
      op: 'bind' as const,
      aircraft: to,
      deviceId: p.deviceId,
      commandId: p.to.commandId,
      combo: p.combo,
    }));
}
