import type { AircraftView, BindingOp, ComboView, DeviceView } from './model';

/**
 * The note the Bind dialog shows when "show or hide the kneeboard" is bound there.
 *
 * That action shows the kneeboard and does nothing else: its pages turn with two more
 * actions. DCS gives all three a key on the keyboard and none on a stick or throttle, so
 * somebody who binds only "show or hide" to a button finds out in the cockpit that the
 * pages do not turn. The note names the page actions that are on no controller and says
 * where each is now. It is made from the bindings in effect and the edits waiting to be
 * saved, and there is none once both are on a controller.
 */

export type KneeboardAction = 'show' | 'next' | 'previous';

/**
 * Which of the kneeboard's three actions this is, from DCS's name for it ("Kneeboard
 * ON/OFF", "Kneeboard Next Page", "Kneeboard Previous Page"). The glance view, the mark
 * point and the shortcuts ("Kneeboard Next Shortcut" jumps between marked pages; it does
 * not turn one) are none of them. The kneeboard dialog of Cheat sheets reads the names the
 * same way; a feature does not import another, so the rule is written here as well.
 */
export function kneeboardActionOf(name: string): KneeboardAction | undefined {
  if (!/kneeboard/i.test(name)) return undefined;
  if (/glance|mark|shortcut/i.test(name)) return undefined;
  if (/\bpage\b/i.test(name)) {
    if (/\bnext\b/i.test(name)) return 'next';
    if (/\bprev(ious)?\b/i.test(name)) return 'previous';
    return undefined;
  }
  if (/\bon\s*\/\s*off\b|\bshow\b|\bhide\b|\btoggle\b/i.test(name)) return 'show';
  return undefined;
}

export interface PageAction {
  key: 'next' | 'previous';
  /** The action to bind. */
  commandId: string;
  /** DCS's name for it: "Kneeboard Next Page". */
  name: string;
  /** Where it is now, none of it a controller: "] on the keyboard". Empty when it is bound to nothing. */
  bound: string[];
  /** False when RigReady cannot write a binding for it yet (model.ts, `editable`). */
  editable: boolean;
}

export interface KneeboardPagesNote {
  /** What the action being bound does and does not do. */
  lead: string;
  /** The page actions that are on no controller, next page first. */
  missing: PageAction[];
  /** What to do about it. */
  advice: string;
  /** Said when RigReady cannot bind one of them itself; absent otherwise. */
  cannot?: string;
  /** The actions the dialog can go on to, in order: the missing ones RigReady can bind. */
  offer: string[];
  /** The label of the button that makes the offer; absent when there is nothing to offer. */
  offerLabel?: string;
}

type Control = Pick<ComboView, 'key' | 'reformers'>;

const controlId = (c: Control): string => [c.key, ...[...c.reformers].sort()].join('+');

const whereOf = (device: DeviceView): string =>
  device.type === 'keyboard'
    ? 'the keyboard'
    : device.type === 'mouse'
      ? 'the mouse'
      : (device.givenName ?? device.name);

/**
 * The note for binding `commandId`, or nothing: when that is not "show or hide the
 * kneeboard", when the aircraft has no action that turns a page, or when every one it has
 * is on a controller. `pending` are the edits not yet written, in the order they were
 * made, with the one being made in the dialog last: a page action staged onto a button
 * counts as bound, and one whose button is being given to something else no longer does.
 */
export function kneeboardPagesNote(
  view: Pick<AircraftView, 'commands' | 'devices'>,
  commandId: string | undefined,
  pending: BindingOp[] = []
): KneeboardPagesNote | undefined {
  const chosen = view.commands.find((c) => c.id === commandId);
  if (!chosen || kneeboardActionOf(chosen.name) !== 'show') return undefined;

  const pages = new Map<string, PageAction['key']>();
  for (const command of view.commands) {
    if (command.unmatched || command.kind !== 'key') continue;
    const key = kneeboardActionOf(command.name);
    if (key === 'next' || key === 'previous') pages.set(command.id, key);
  }
  if (pages.size === 0) return undefined;

  const controllers = view.devices.filter((d) => d.type === 'joystick');
  const isController = new Set(controllers.map((d) => d.id));
  // Where the page actions are on a controller now. A binding on a control the device does
  // not have can never fire, so it does not count.
  let held: { deviceId: string; commandId: string; control: string }[] = [];
  for (const device of controllers) {
    for (const binding of device.bindings) {
      if (binding.inert || !pages.has(binding.commandId)) continue;
      held.push({
        deviceId: device.id,
        commandId: binding.commandId,
        control: controlId(binding.combo),
      });
    }
  }
  // And where they will be once the edits that wait are written.
  for (const op of pending) {
    if (!isController.has(op.deviceId)) continue;
    if (op.op === 'clearDevice') {
      held = held.filter((h) => h.deviceId !== op.deviceId);
      continue;
    }
    if (op.op === 'setFilter') continue;
    const control = controlId(op.combo);
    if (op.op === 'unbind') {
      held = held.filter(
        (h) =>
          !(h.deviceId === op.deviceId && h.commandId === op.commandId && h.control === control)
      );
      continue;
    }
    // A control of a device does one thing: binding it takes it from what it did before.
    held = held.filter((h) => !(h.deviceId === op.deviceId && h.control === control));
    if (pages.has(op.commandId)) {
      held.push({ deviceId: op.deviceId, commandId: op.commandId, control });
    }
  }

  const elsewhere = (id: string): string[] =>
    view.devices
      .filter((d) => d.type !== 'joystick')
      .flatMap((d) =>
        d.bindings
          .filter((b) => b.commandId === id && !b.inert)
          .map((b) => `${b.label} on ${whereOf(d)}`)
      );

  const missing: PageAction[] = [];
  for (const key of ['next', 'previous'] as const) {
    const commands = view.commands.filter((c) => pages.get(c.id) === key);
    if (commands.length === 0) continue;
    if (held.some((h) => pages.get(h.commandId) === key)) continue;
    const command = commands.find((c) => c.editable) ?? commands[0]!;
    missing.push({
      key,
      commandId: command.id,
      name: command.name,
      bound: [...new Set(commands.flatMap((c) => elsewhere(c.id)))],
      editable: command.editable,
    });
  }
  if (missing.length === 0) return undefined;

  const both = new Set(pages.values()).size === 2;
  const lead = !both
    ? 'This shows and hides the kneeboard. Its pages turn with another action, and that is not on a controller yet.'
    : missing.length === 2
      ? 'This shows and hides the kneeboard. Its pages turn with two other actions, and neither is on a controller yet.'
      : 'This shows and hides the kneeboard. Its pages turn with two other actions, and one of them is not on a controller yet.';
  const advice =
    missing.length === 2
      ? 'Bind each to a button too, to turn the pages from your stick or throttle.'
      : both
        ? 'Bind it to a button too, to turn the pages both ways from your stick or throttle.'
        : 'Bind it to a button too, to turn the pages from your stick or throttle.';
  const stuck = missing.filter((m) => !m.editable).map((m) => `"${m.name}"`);
  const offer = missing.filter((m) => m.editable).map((m) => m.commandId);
  return {
    lead,
    missing,
    advice,
    ...(stuck.length > 0
      ? {
          cannot: `RigReady cannot write a binding for ${stuck.join(' and ')} yet. Bind ${stuck.length === 1 ? 'it' : 'them'} in DCS's own controls screen.`,
        }
      : {}),
    offer,
    ...(offer.length > 0
      ? { offerLabel: `Add this and bind ${offer.length === 1 ? 'it' : 'them'} next` }
      : {}),
  };
}
