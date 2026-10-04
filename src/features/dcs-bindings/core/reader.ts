import type {
  AircraftBindings,
  BindingReader,
  BoundDevice,
  BoundInput,
} from '../../../core/bindings';
import { ok } from '../../../core/result';
import type { DcsBindings } from './bindings';
import type { AircraftView, DeviceView } from './model';
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
      bindings: device.bindings
        // A default on a control the device does not have can never fire.
        .filter((binding) => !binding.inert)
        .map((binding): BoundInput => {
          const input = describeInput(binding.combo.key);
          const command = commands.get(binding.commandId);
          return {
            input: binding.combo.key,
            inputLabel: input.label,
            kind: input.kind,
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
  };
}
