import {
  controlFromDirectInput,
  type AircraftBindings,
  type BindingProposal,
  type BindingReader,
  type BoundAction,
  type BoundDevice,
  type BoundInput,
} from '../../../core/bindings';
import { err, ok, type Result } from '../../../core/result';
import type { DcsBindings } from './bindings';
import { applyEdits, planEdits } from './edits';
import type { AircraftView, BindingOp, DeviceView } from './model';
import { describeInput } from './names';

/**
 * DCS bindings for the rest of the app (`ctx.bindings.get('dcs')`): the same effective
 * bindings the bindings pages show, in core's game-neutral shape.
 */

/** The page of this feature that shows one device's bindings. */
export const DEVICES_ROUTE = '/configure/dcs-bindings/devices';

const KIND: Record<DeviceView['type'], BoundDevice['kind']> = {
  joystick: 'controller',
  keyboard: 'keyboard',
  mouse: 'mouse',
  trackir: 'other',
  headtracker: 'other',
};

/** The modifiers of "LCtrl + Button 5 on Stick + Button 34": everything before the input. */
function modifiersOf(label: string, count: number): string[] {
  if (count === 0) return [];
  return label.split(' + ').slice(0, -1);
}

export function toAircraftBindings(view: AircraftView): AircraftBindings {
  const commands = new Map(view.commands.map((c) => [c.id, c]));
  return {
    aircraft: {
      id: view.aircraft.id,
      name: view.aircraft.name,
      hasUserBindings: view.aircraft.userFiles > 0,
    },
    devices: view.devices.map((device) => ({
      kind: KIND[device.type],
      name: device.name,
      ...(device.givenName ? { givenName: device.givenName } : {}),
      ...(device.guid ? { guid: device.guid.toUpperCase() } : {}),
      ...(device.vendorId ? { vendorId: device.vendorId } : {}),
      ...(device.productId ? { productId: device.productId } : {}),
      connected: device.connected,
      role: device.role,
      ...(device.type === 'joystick'
        ? {
            controls: {
              buttons: device.numButtons,
              hats: device.numHats,
              axes: device.axisNames,
            },
          }
        : {}),
      bindings: device.bindings
        // A default on a control the device does not have can never fire.
        .filter((binding) => !binding.inert)
        .map((binding): BoundInput => {
          const input = describeInput(binding.combo.key);
          const command = commands.get(binding.commandId);
          const control = controlFromDirectInput(binding.combo.key);
          return {
            input: binding.combo.key,
            inputLabel: input.label,
            kind: input.kind,
            ...(control ? { control } : {}),
            modifiers: modifiersOf(binding.label, binding.combo.reformers.length),
            actionId: binding.commandId,
            action: command?.name ?? binding.commandId,
            category: command?.category ?? [],
            source: binding.source === 'user' ? 'user' : 'default',
          };
        }),
    })),
  };
}

export function createBindingReader(bindings: DcsBindings): BindingReader {
  return {
    game: 'dcs',
    gameName: 'DCS World',
    async available() {
      const locations = await bindings.locations();
      return locations.found || locations.installDir !== undefined;
    },
    async aircraft() {
      const overview = await bindings.overview();
      if (!overview.ok) return overview;
      return ok(
        overview.value.aircraft.map((a) => ({
          id: a.id,
          name: a.name,
          hasUserBindings: a.userFiles > 0,
        }))
      );
    },
    async bindings(aircraftId) {
      const view = await bindings.view(aircraftId);
      return view.ok ? ok(toAircraftBindings(view.value)) : view;
    },
    route(target = {}) {
      const query = new URLSearchParams();
      if (target.aircraftId) query.set('aircraft', target.aircraftId);
      if (target.guid) query.set('guid', target.guid.replace(/[{}]/g, '').toUpperCase());
      const text = query.toString();
      return text ? `${DEVICES_ROUTE}?${text}` : DEVICES_ROUTE;
    },
    async actions(aircraftId) {
      const view = await bindings.view(aircraftId);
      if (!view.ok) return view;
      return ok(
        view.value.commands
          .filter((c) => !c.unmatched)
          .map((c): BoundAction => ({
            id: c.id,
            name: c.name,
            category: c.category,
            kind: c.kind === 'axis' ? 'axis' : 'button',
            editable: c.editable,
          }))
      );
    },
    proposals: {
      async plan(proposal) {
        const ops = await proposalOps(bindings, proposal);
        return ops.ok ? planEdits(bindings, ops.value, proposal.summary) : ops;
      },
      async apply(proposal) {
        const ops = await proposalOps(bindings, proposal);
        if (!ops.ok) return ops;
        const applied = await applyEdits(bindings, ops.value, proposal.summary);
        if (applied.ok) bindings.ctx.log.info(`dcs-bindings: ${applied.value.summary}`);
        return applied;
      },
      async undo(groupId) {
        if (await bindings.dcsRunning()) {
          return err(
            'dcs.running',
            'DCS is running. Close it before undoing a change to its bindings.'
          );
        }
        const undone = await bindings.ctx.ports.files.undoGroup(groupId);
        if (undone.ok) bindings.ctx.changed?.();
        return undone.ok ? ok(undefined) : undone;
      },
    },
  };
}

/** A proposal from another feature as this feature's own edits, on the devices DCS knows. */
async function proposalOps(
  bindings: DcsBindings,
  proposal: BindingProposal
): Promise<Result<BindingOp[]>> {
  if (proposal.changes.length === 0) return err('dcs.proposal.empty', 'Nothing to change.');
  const view = await bindings.view(proposal.aircraftId);
  if (!view.ok) return view;
  const ops: BindingOp[] = [];
  for (const change of proposal.changes) {
    const wanted = change.deviceGuid?.replace(/[{}]/g, '').toUpperCase();
    const device = view.value.devices.find((d) =>
      wanted ? d.type === 'joystick' && d.guid?.toUpperCase() === wanted : d.type === 'keyboard'
    );
    if (!device) {
      return err(
        'dcs.device.unknown',
        wanted
          ? `DCS has no controller with the id ${wanted} for ${view.value.aircraft.name}.`
          : `DCS has no keyboard bindings for ${view.value.aircraft.name}.`
      );
    }
    if (!view.value.commands.some((c) => c.id === change.actionId)) {
      return err(
        'dcs.command.unknown',
        `${view.value.aircraft.name} has no action "${change.actionId}".`
      );
    }
    ops.push({
      op: change.op,
      aircraft: proposal.aircraftId,
      deviceId: device.id,
      commandId: change.actionId,
      combo: { key: change.input, reformers: change.modifiers ?? [] },
    });
  }
  return ok(ops);
}
