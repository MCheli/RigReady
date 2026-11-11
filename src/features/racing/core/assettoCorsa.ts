import path from 'node:path';
import type { AcView } from '../contract';
import {
  installOf,
  isRunning,
  liveControllers,
  locationOf,
  racingGame,
  type RacingContext,
} from './context';
import { bindingCounts, listedControllers, matchControllers, orderKnown } from './acRepair';
import { parseIni } from './acIni';
import { axisName, vidPidFromProductGuid } from './devices';

/**
 * Assetto Corsa's Documents\Assetto Corsa\cfg\controls.ini: [CONTROLLERS] lists each
 * controller (CONn name, __IGUIDn instance GUID, PGUIDn product GUID); every action is a
 * section with JOY (controller number), AXLE (axis) or BUTTON, and KEY. Read here; the one
 * change RigReady makes is renumbering the controllers (acRepair.ts).
 */

export { parseIni, type Ini } from './acIni';

const ACTIONS: Record<string, string> = {
  STEER: 'Steering',
  THROTTLE: 'Throttle',
  BRAKES: 'Brake',
  CLUTCH: 'Clutch',
  HANDBRAKE: 'Handbrake',
  GEARUP: 'Shift up',
  GEARDN: 'Shift down',
  BALANCEUP: 'Brake balance forward',
  BALANCEDN: 'Brake balance rearward',
  KERS: 'KERS',
  DRS: 'DRS',
  ABSUP: 'ABS up',
  ABSDN: 'ABS down',
  TCUP: 'Traction control up',
  TCDN: 'Traction control down',
  TURBOUP: 'Turbo up',
  TURBODN: 'Turbo down',
  ENGINE_BRAKE_UP: 'Engine brake up',
  ENGINE_BRAKE_DN: 'Engine brake down',
  MGUK_DELIVERY_UP: 'MGU-K delivery up',
  MGUK_DELIVERY_DN: 'MGU-K delivery down',
  MGUK_RECOVERY_UP: 'MGU-K recovery up',
  MGUK_RECOVERY_DN: 'MGU-K recovery down',
  MGUH_MODE: 'MGU-H mode',
  HEADLIGHTS: 'Headlights',
  HEADLIGHTS_FLASH: 'Flash headlights',
  HORN: 'Horn',
  GLANCELEFT: 'Look left',
  GLANCERIGHT: 'Look right',
  GLANCEBACK: 'Look back',
  ACTION_CHANGE_CAMERA: 'Change camera',
  ACTION_PAUSE: 'Pause',
  ACTION_START_STOP_ENGINE: 'Start engine',
  ACTION_HEADLIGHTS: 'Headlights',
  ACTION_HORN: 'Horn',
};

export const AC_AXES = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'S0', 'S1'];

export function acActionLabel(section: string): string {
  if (ACTIONS[section]) return ACTIONS[section];
  const gear = /^GEAR_(\d+|R|N)$/.exec(section);
  if (gear)
    return gear[1] === 'R' ? 'Reverse gear' : gear[1] === 'N' ? 'Neutral' : `Gear ${gear[1]}`;
  const text = section
    // Content Manager and Custom Shaders Patch add their own sections: __CM_ABS, __EXT_HAZARDS.
    .replace(/^_+(CM|EXT)_/, '')
    .replace(/^ACTION_/, '')
    .replace(/_/g, ' ')
    .toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const shortId = (guid: string): string => `${guid.slice(0, 8)}…${guid.slice(19, 23)}`;

export async function acView(ctx: RacingContext): Promise<AcView> {
  const install = await installOf(ctx, 'assetto-corsa');
  const view: AcView = {
    installed: install !== undefined,
    running: await isRunning(ctx, racingGame('assetto-corsa').processes),
    orderKnown: false,
    repairNeeded: false,
    problems: [],
    controllers: [],
    bindings: [],
    forceFeedback: [],
  };
  const cfg = await locationOf(ctx, 'assetto-corsa', 'cfg');
  if (!cfg) return view;
  const file = path.join(cfg, 'controls.ini');
  view.controlsFile = file;
  if (!(await ctx.ports.files.exists(file))) return view;
  const text = await ctx.ports.files.readText(file);
  if (!text.ok) {
    view.problems.push(text.error.message);
    return view;
  }
  const ini = parseIni(text.value);
  view.inputMethod = ini.get('HEADER')?.get('INPUT_METHOD')?.value;
  const live = await liveControllers(ctx);
  view.orderKnown = live !== undefined && orderKnown(live);
  const counts = bindingCounts(ini);
  const label = (d: {
    name: string;
    guid: string;
    numButtons: number;
    enumerationIndex?: number;
  }) =>
    `${d.name.trim()} · ${d.numButtons} buttons · number ${d.enumerationIndex ?? '?'} · id ${shortId(d.guid)}`;
  for (const m of matchControllers(listedControllers(ini), live)) {
    const ids = vidPidFromProductGuid(m.listed.productGuid);
    const bindingCount = counts.get(m.listed.index) ?? 0;
    view.controllers.push({
      index: m.listed.index,
      name: m.listed.name,
      instanceGuid: m.listed.instanceGuid,
      productGuid: m.listed.productGuid,
      ...(ids ? { vendorId: ids.vendorId, productId: ids.productId } : {}),
      state: m.state,
      used: bindingCount > 0,
      bindingCount,
      ...(m.target
        ? {
            now: {
              guid: m.target.guid,
              name: m.target.name.trim(),
              ...(m.target.enumerationIndex !== undefined
                ? { number: m.target.enumerationIndex }
                : {}),
            },
          }
        : {}),
      candidates: m.candidates.map((d) => ({ guid: d.guid, label: label(d) })),
    });
  }
  view.repairNeeded =
    view.orderKnown &&
    view.controllers.some(
      (c) =>
        c.used &&
        (c.state === 'reordered' ||
          c.state === 'moved' ||
          // Not connected, but its number is a connected controller's: its bindings act on that one.
          (c.state === 'missing' && live!.some((d) => d.enumerationIndex === c.index)))
    );
  for (const [section, values] of ini) {
    const joy = Number.parseInt(values.get('JOY')?.value ?? '', 10);
    const axle = Number.parseInt(values.get('AXLE')?.value ?? '', 10);
    const button = Number.parseInt(values.get('BUTTON')?.value ?? '', 10);
    const key = values.get('KEY');
    const controller = view.controllers.find((c) => c.index === joy);
    const inputs: string[] = [];
    if (joy >= 0 && axle >= 0 && AC_AXES[axle]) {
      inputs.push(axisName(AC_AXES[axle]!, controller?.vendorId, controller?.productId));
    }
    if (joy >= 0 && button >= 0) inputs.push(`Button ${button + 1}`);
    if (inputs.length > 0) {
      if (controller) controller.used = true;
      // What the game will really use: the controller at that number in Windows' order now.
      const actsOn = view.orderKnown
        ? (live!.find((d) => d.enumerationIndex === joy)?.name.trim() ?? 'Nothing connected')
        : undefined;
      view.bindings.push({
        action: section,
        label: acActionLabel(section),
        controller: controller?.name ?? `Controller ${joy}`,
        input: inputs.join(', '),
        number: joy,
        ...(actsOn !== undefined ? { actsOn } : {}),
      });
    }
    if (key && key.value !== '-1' && key.value !== '' && values.has('BUTTON')) {
      view.bindings.push({
        action: section,
        label: acActionLabel(section),
        controller: 'Keyboard',
        input: key.comment || key.value,
      });
    }
  }
  const steer = ini.get('STEER');
  const ffb: [string, string, string][] = [
    ['STEER', 'LOCK', 'Steering lock (degrees)'],
    ['STEER', 'FF_GAIN', 'Force feedback gain'],
    ['STEER', 'FILTER_FF', 'Force feedback filter'],
    ['FF_TWEAKS', 'MIN_FF', 'Minimum force'],
    ['FF_ENHANCEMENT', 'CURBS', 'Kerb effects'],
    ['FF_ENHANCEMENT', 'ROAD', 'Road effects'],
    ['FF_ENHANCEMENT', 'SLIPS', 'Slip effects'],
    ['FF_ENHANCEMENT', 'ABS', 'ABS effects'],
  ];
  if (steer) {
    for (const [section, key, name] of ffb) {
      const value = ini.get(section)?.get(key)?.value;
      if (value !== undefined) view.forceFeedback.push({ label: name, value });
    }
  }
  return view;
}
