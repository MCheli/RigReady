import { comboId } from './diff';
import { importantActions } from './important';
import {
  ROLE_LABELS,
  type BindingView,
  type CommandView,
  type DeviceRole,
  type DeviceView,
  type ProblemsView,
} from './model';
import { comboLabel } from './names';

/** A role guessed from the device's name. The user can change it. */
export function suggestRole(name: string): DeviceRole {
  if (/wheel\s*base|racing|\bwheel\b/i.test(name)) return 'none';
  if (/rudder|pedal/i.test(name)) return 'pedals';
  if (/\bmfd/i.test(name)) return 'mfd';
  if (/throttle/i.test(name)) return 'throttle';
  if (/joystick|stick|grip/i.test(name)) return 'stick';
  if (/panel|ufc|icp|hud|button\s*box|\bbox\b/i.test(name)) return 'panel';
  return 'other';
}

/** What a default binding does, as far as cleanup is concerned. */
type DefaultFunction = 'pitch' | 'roll' | 'rudder' | 'thrust' | 'brakes' | 'view' | 'button';

const FUNCTION_LABEL: Record<DefaultFunction, string> = {
  pitch: 'Pitch',
  roll: 'Roll',
  rudder: 'Rudder',
  thrust: 'Throttle',
  brakes: 'Wheel brake',
  view: 'View',
  button: 'A default button',
};

function functionOf(binding: BindingView, command: CommandView): DefaultFunction {
  const purpose = binding.purpose ?? '';
  if (purpose === 'pitch') return 'pitch';
  if (purpose === 'roll') return 'roll';
  if (purpose === 'rudder') return 'rudder';
  if (purpose.startsWith('thrust')) return 'thrust';
  if (purpose.includes('wheel_brake')) return 'brakes';
  if (/^(View |Center View$|Zoom )/.test(command.name) || command.category.includes('View')) {
    return 'view';
  }
  return 'button';
}

/** Which roles a default of that kind belongs on, given what else is on the rig. */
function wanted(fn: DefaultFunction, role: DeviceRole, roles: Set<DeviceRole>): boolean {
  if (role === 'other') return true;
  if (role === 'none' || role === 'panel' || role === 'mfd') return false;
  switch (fn) {
    case 'pitch':
    case 'roll':
    case 'view':
    case 'button':
      return role === 'stick';
    case 'rudder':
      return role === 'pedals' || (role === 'stick' && !roles.has('pedals'));
    case 'thrust':
      return role === 'throttle' || (role === 'stick' && !roles.has('throttle'));
    case 'brakes':
      return role === 'pedals';
  }
}

const isController = (device: DeviceView): boolean => device.type === 'joystick';

export interface ProblemInput {
  aircraftId: string;
  devices: DeviceView[];
  commands: CommandView[];
  /** Command ids the user marked as intentionally bound more than once. */
  expected: Set<string>;
}

export function findProblems(input: ProblemInput): ProblemsView {
  const commands = new Map(input.commands.map((c) => [c.id, c]));
  const controllers = input.devices.filter(isController);
  const roles = new Set(controllers.filter((d) => d.connected).map((d) => d.role));

  // One input, several actions (same key and same modifiers on one device).
  const inputConflicts: ProblemsView['inputConflicts'] = [];
  for (const device of controllers) {
    const byCombo = new Map<string, BindingView[]>();
    for (const binding of device.bindings.filter((b) => !b.inert)) {
      const id = comboId(binding.combo);
      byCombo.set(id, [...(byCombo.get(id) ?? []), binding]);
    }
    for (const [id, bindings] of byCombo) {
      const ids = [...new Set(bindings.map((b) => b.commandId))];
      if (ids.length < 2) continue;
      inputConflicts.push({
        id: `${device.id}|${id}`,
        deviceId: device.id,
        deviceName: device.name,
        combo: bindings[0]!.combo,
        label: bindings[0]!.label,
        commandIds: ids,
      });
    }
  }

  // One action, several inputs or devices.
  const occurrences = new Map<string, ProblemsView['actionDuplicates'][number]['occurrences']>();
  for (const device of controllers) {
    for (const binding of device.bindings.filter((b) => !b.inert)) {
      occurrences.set(binding.commandId, [
        ...(occurrences.get(binding.commandId) ?? []),
        {
          deviceId: device.id,
          deviceName: device.name,
          combo: binding.combo,
          label: binding.label,
          source: binding.source,
        },
      ]);
    }
  }
  const actionDuplicates: ProblemsView['actionDuplicates'] = [];
  for (const [commandId, list] of occurrences) {
    if (list.length < 2) continue;
    actionDuplicates.push({
      commandId,
      occurrences: list,
      expected: input.expected.has(commandId),
      acrossDevices: new Set(list.map((o) => o.deviceId)).size > 1,
    });
  }
  const nameOf = (id: string): string => commands.get(id)?.name ?? id;
  actionDuplicates.sort(
    (a, b) =>
      Number(b.acrossDevices) - Number(a.acrossDevices) ||
      nameOf(a.commandId).localeCompare(nameOf(b.commandId))
  );

  // Defaults on devices that are not meant for them.
  const unwantedDefaults: ProblemsView['unwantedDefaults'] = [];
  for (const device of controllers) {
    for (const binding of device.bindings) {
      if (binding.source !== 'default' || binding.inert) continue;
      const command = commands.get(binding.commandId);
      if (!command) continue;
      const fn = functionOf(binding, command);
      if (wanted(fn, device.role, roles)) continue;
      const on =
        device.role === 'none'
          ? 'a device not used in DCS'
          : `${/^[aeiou]/i.test(ROLE_LABELS[device.role]) ? 'an' : 'a'} ${ROLE_LABELS[device.role].toLowerCase()}`;
      unwantedDefaults.push({
        id: `${device.id}|${binding.commandId}|${comboId(binding.combo)}`,
        deviceId: device.id,
        deviceName: device.name,
        commandId: binding.commandId,
        combo: binding.combo,
        label: binding.label,
        reason: `${FUNCTION_LABEL[fn]} on ${on}`,
      });
    }
  }

  // Important actions with nothing bound on any controller.
  const boundOnController = new Set<string>();
  for (const device of controllers) {
    for (const binding of device.bindings)
      if (!binding.inert) boundOnController.add(binding.commandId);
  }
  const keyboard = input.devices.find((d) => d.type === 'keyboard');
  const importantUnbound: ProblemsView['importantUnbound'] = [];
  for (const tier of importantActions(input.aircraftId).tiers) {
    for (const item of tier.items) {
      const matching = input.commands.filter(
        (c) => !c.unmatched && item.patterns.some((p) => p.test(c.name))
      );
      if (matching.length === 0) continue;
      if (matching.some((c) => boundOnController.has(c.id))) continue;
      const key = keyboard?.bindings.find((b) => matching.some((c) => c.id === b.commandId));
      importantUnbound.push({
        id: item.id,
        tier: tier.tier,
        tierTitle: tier.title,
        title: item.title,
        why: item.why,
        commandIds: matching.map((c) => c.id),
        ...(key ? { keyboard: comboLabel(key.combo) } : {}),
      });
    }
  }

  return { inputConflicts, actionDuplicates, unwantedDefaults, importantUnbound };
}
