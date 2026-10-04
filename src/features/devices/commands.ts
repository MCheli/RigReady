import {
  commandFailed,
  defineCommands,
  type CommandOutcome,
  type CommandShell,
} from '../../shared/feature';
import type { InputState } from '../../shared/models';
import { devicesContract } from './contract';
import { detectIdentify, type IdentifyHit } from './core/input';

/**
 * Devices for the command palette: the tool pages under their own names, and "Find a
 * device", which works from any screen: it listens to the controllers the way the Devices
 * page does, and when a button is pressed it says which device that was and opens it there.
 */

const PAGE = '/configure/devices';
const openDevices = { label: 'Open Devices', to: PAGE };

/** How long "Find a device" listens before it says that nothing was pressed. */
export const FIND_SECONDS = 20;

let finds = 0;

async function findDevice(shell: CommandShell): Promise<CommandOutcome> {
  const api = shell.client(devicesContract);
  const overview = await api.overview();
  if (!overview.ok) return commandFailed(overview.error, openDevices);
  const controllers = await api.inputDevices();
  if (!controllers.ok) return commandFailed(controllers.error, openDevices);
  if (controllers.value.length === 0) {
    return {
      tone: 'warn',
      text: 'No game controller is connected',
      detail: 'Plug in the stick, wheel or panel you are looking for and try again.',
      action: openDevices,
    };
  }

  const client = `palette-find-${++finds}`;
  // Where each controller rests: a switch that is held on is not a press.
  const rest = new Map<number, InputState>();
  let done: (hit: IdentifyHit | undefined) => void = () => undefined;
  const pressed = new Promise<IdentifyHit | undefined>((resolve) => (done = resolve));
  const off = api.on('input', ({ states }) => {
    for (const state of states) {
      const before = rest.get(state.index);
      if (!before) {
        rest.set(state.index, state);
        continue;
      }
      const controller = controllers.value.find((c) => c.index === state.index);
      const hit = detectIdentify(controller, before, state);
      if (hit) done(hit);
    }
  });
  const timer = setTimeout(() => done(undefined), FIND_SECONDS * 1000);
  let hit: IdentifyHit | undefined;
  try {
    const watching = await api.watchInput({ client, on: true });
    if (!watching.ok) return commandFailed(watching.error, openDevices);
    shell.progress('Press a button on the device you are looking for…');
    hit = await pressed;
  } finally {
    clearTimeout(timer);
    off();
    await api.watchInput({ client, on: false });
  }
  if (!hit) {
    return {
      tone: 'info',
      text: 'Nothing was pressed',
      detail: `Find a device listened for ${FIND_SECONDS} seconds. Run it again when you are at the device.`,
      action: openDevices,
    };
  }

  const index = hit.index;
  const device = overview.value.devices.find((d) => d.controllers.some((c) => c.index === index));
  const controller = controllers.value.find((c) => c.index === index);
  const name = device?.name ?? controller?.name.trim() ?? `Controller ${index + 1}`;
  if (!device) {
    return {
      tone: 'warn',
      text: `That is ${name}`,
      detail: `${hit.input} was pressed. It is not among the USB devices RigReady lists.`,
      action: openDevices,
    };
  }
  await shell.go(`${PAGE}?select=${encodeURIComponent(device.key)}`);
  return {
    tone: 'ok',
    text: `That is ${name}`,
    detail:
      device.controllersShared && device.twins > 1
        ? `${hit.input} was pressed. It is one of ${device.twins} identical devices that cannot be told apart here.`
        : `${hit.input} was pressed. It is open on the Devices page.`,
  };
}

export default defineCommands({
  feature: 'devices',
  commands: [
    {
      id: 'devices.find',
      title: 'Find a device',
      hint: 'Press a button on it',
      icon: 'mdi-gesture-tap',
      keywords: ['identify', 'which', 'controller', 'stick', 'panel'],
      run: findDevice,
    },
    {
      id: 'devices.tester',
      title: 'Input tester',
      icon: 'mdi-gesture-tap-button',
      keywords: ['test', 'buttons', 'axes', 'live', 'joy.cpl'],
      to: `${PAGE}/test`,
    },
    {
      id: 'devices.health',
      title: 'Health check',
      icon: 'mdi-stethoscope',
      keywords: ['stuck', 'noisy', 'jitter', 'rogue', 'drift'],
      to: `${PAGE}/health`,
    },
    {
      id: 'devices.usb',
      title: 'USB map',
      icon: 'mdi-family-tree',
      keywords: ['hub', 'port', 'tree'],
      to: `${PAGE}/usb`,
    },
    {
      // The navigation entry keeps its name; these are more words it is found by.
      id: 'devices.page',
      title: 'Controllers and hardware',
      keywords: ['hotas', 'joystick', 'wheel', 'pedals', 'hidhide', 'rename'],
      to: PAGE,
    },
  ],
});
