import { sameGuid } from '../../../core/directInput';
import { sha256 } from '../../../core/files/fileStore';
import { changePreview } from '../../../core/files/preview';
import { gameRunning } from '../../../core/games';
import type { ControllerPress } from '../../../core/inputPresses';
import type { DeviceNames } from '../../../core/names';
import { err, ok, type Result } from '../../../core/result';
import type {
  BindingSet,
  ChangeRequest,
  ChangeResult,
  ChangeReview,
  Pressed,
  SetView,
} from '../contract';
import { changeBinding, type Change, type NewBinding } from './edit';
import { inWords, setScope } from './names';
import { findSet, setView, simulatorOf, type BindingsContext } from './view';

/**
 * Changing one binding of a set: what the page shows first, and the write. The bytes are
 * made by edit.ts; this finds the file, says what the change means, and puts it in place
 * through FileStore (a backup first, one entry on the Safety page).
 *
 * A button and a key written here were used by iRacing 2026.11.02.01 on the owner's rig on
 * 13 Nov 2026 (docs/research/iracing-bindings.md, "The rig tests of 13 Nov 2026").
 */

const WHY_CLOSED =
  'Close iRacing first. iRacing writes its bindings when it closes and would undo the change.';

/**
 * Why the file cannot be written right now, when it cannot. Not knowing whether iRacing is
 * open is not the same as "closed": the file is not written on a guess.
 */
export async function whyBlocked(ctx: BindingsContext): Promise<string | undefined> {
  const list = await ctx.ports.processes.list();
  if (!list.ok) {
    return 'RigReady could not see which programs are running, so it cannot tell whether iRacing is open.';
  }
  return (await gameRunning(ctx, simulatorOf(ctx))) ? WHY_CLOSED : undefined;
}

interface Plan {
  view: SetView;
  after: SetView;
  change: Change;
  /** What this plan was made from: the file, the cars it is for, and its content. */
  seen: string;
}

/**
 * One SHA-256 for what the user approves: which file the set is (app.ini can point "All
 * cars" at another profile with the same bytes), which cars it applies to, and the bytes.
 * Save writes nothing when any of the three is no longer what the preview showed.
 */
export const seenOf = (set: BindingSet, bytes: Uint8Array): string =>
  sha256(
    JSON.stringify({
      file: set.file.toLowerCase(),
      cars: [set.name, ...(set.sharedWith ?? [])],
      content: sha256(bytes),
    })
  );

/** The binding asked for, with the ids of the controller as it is plugged in now. */
async function wanted(ctx: BindingsContext, request: ChangeRequest): Promise<Result<NewBinding>> {
  const to = request.binding;
  if (to === null || to.kind === 'key') return ok(to);
  // Both ids come from the controller Windows lists, never from the page.
  const started = await ctx.ports.input.start();
  if (!started.ok) {
    return err(
      'iracing-bindings.edit.controllers',
      'RigReady could not read the controllers, so it cannot bind a button.',
      started.error.message
    );
  }
  const device = started.value.find((d) => sameGuid(d.guid, to.device));
  if (!device) {
    return err(
      'iracing-bindings.edit.unplugged',
      'That controller is not plugged in. Plug it in and press the button again.'
    );
  }
  if (to.button > device.numButtons) {
    return err('iracing-bindings.edit.button', `${device.name.trim()} has no button ${to.button}.`);
  }
  return ok({
    kind: 'button',
    instanceGuid: device.guid,
    productGuid: device.productGuid,
    button: to.button - 1,
  });
}

async function plan(
  ctx: BindingsContext,
  request: ChangeRequest,
  names: DeviceNames
): Promise<Result<Plan>> {
  const found = await findSet(ctx, request.set);
  if (!found.ok) return found;
  const bytes = await ctx.ports.files.readBytes(found.value.set.file);
  if (!bytes.ok) {
    return err(
      'iracing-bindings.read',
      `RigReady could not read ${found.value.set.file}.`,
      bytes.error.message
    );
  }
  const to = await wanted(ctx, request);
  if (!to.ok) return to;
  const change = changeBinding(bytes.value, request.action, to.value);
  if (!change.ok) return change;
  // The set as the page shows it, now and with the changed bytes: the same words either way.
  const view = await setView(ctx, request.set, names);
  if (!view.ok) return view;
  const after = await setView(ctx, request.set, names, change.value.bytes);
  if (!after.ok) return after;
  return ok({
    view: view.value,
    after: after.value,
    change: change.value,
    seen: seenOf(found.value.set, bytes.value),
  });
}

const actionOf = (view: SetView, id: string): SetView['actions'][number] | undefined =>
  view.actions.find((a) => a.id === id);

/** What one change would do, for the user to read before anything is written. Writes nothing. */
export async function reviewChange(
  ctx: BindingsContext,
  request: ChangeRequest,
  names: DeviceNames
): Promise<Result<ChangeReview>> {
  const planned = await plan(ctx, request, names);
  if (!planned.ok) return planned;
  const { view, after, change } = planned.value;
  const now = actionOf(view, request.action);
  const then = actionOf(after, request.action);
  if (!now || !then)
    return err('iracing-bindings.edit.noAction', 'iRacing has no such action in this set.');
  // Everything else the same button or key does once this is saved.
  const shared = then.binding
    ? after.shared.find((s) => s.actions.some((a) => a.id === request.action))
    : undefined;
  const preview = await changePreview(ctx.ports.files, [
    { path: view.set.file, content: change.bytes },
  ]);
  if (!preview.ok) return preview;
  const blocked = await whyBlocked(ctx);
  return ok({
    set: view.set,
    action: { id: now.id, name: now.name },
    before: inWords(now.binding),
    after: inWords(then.binding),
    same: change.same,
    conflicts: (shared?.actions ?? [])
      .filter((a) => a.id !== request.action)
      .map((a) => ({ ...a, cameraEditor: /^Cam[A-Z]/.test(a.id) })),
    ...(blocked ? { blocked } : {}),
    preview: preview.value,
    seen: planned.value.seen,
  });
}

/**
 * Writes one change into the set's controls.cfg: refused while iRacing runs, a backup
 * first, and the file is read back before anything is called done. The page calls this
 * only from the review's Save button, never straight after a press.
 */
export async function applyChange(
  ctx: BindingsContext,
  request: ChangeRequest,
  names: DeviceNames
): Promise<Result<ChangeResult>> {
  const blocked = await whyBlocked(ctx);
  if (blocked) return err('iracing-bindings.edit.blocked', blocked);
  const planned = await plan(ctx, request, names);
  if (!planned.ok) return planned;
  // Worked out again from the file as it is now: when that is not the file the preview was
  // made from, its "now", its conflicts and what the user approved may not hold.
  if (request.seen !== undefined && request.seen !== planned.value.seen) {
    return err(
      'iracing-bindings.edit.changed',
      'controls.cfg, or which file or cars it is for, changed after the change was shown, so nothing was written. Look at the change again.'
    );
  }
  const { view, after, change } = planned.value;
  const name = actionOf(view, request.action)?.name ?? request.action;
  const to = inWords(actionOf(after, request.action)?.binding);
  const file = view.set.file;
  // Every car the file is for, here and on the Safety page.
  const where = `for ${setScope(view.set)}`;
  if (change.same) {
    return ok({
      changed: false,
      message:
        request.binding === null
          ? `Nothing was changed: ${name} is not bound.`
          : `Nothing was changed: ${name} is already bound to ${to}.`,
      file,
    });
  }
  const group = ctx.ports.files.beginGroup(
    request.binding === null
      ? `iRacing bindings ${where}: ${name} cleared`
      : `iRacing bindings ${where}: ${name} bound to ${to}`
  );
  const written = await ctx.ports.files.write(file, change.bytes, {
    reason: 'Change one binding in controls.cfg',
    group,
  });
  if (!written.ok) return written;
  // Read back: only report what is really on disk.
  const back = await ctx.ports.files.readBytes(file);
  if (!back.ok) return back;
  if (
    back.value.length !== change.bytes.length ||
    !back.value.every((value, i) => value === change.bytes[i])
  ) {
    return err('iracing-bindings.edit.notKept', 'controls.cfg did not keep the change.');
  }
  return ok({
    changed: true,
    message:
      request.binding === null
        ? `Saved in iRacing’s file ${where}: ${name} is no longer bound. Undo is on the Safety page.`
        : `Saved in iRacing’s file ${where}: ${name} is now bound to ${to}. Undo is on the Safety page.`,
    file,
  });
}

/** A controller press as the page hears it while it waits for one. */
export function pressedOf(press: ControllerPress, names: DeviceNames): Pressed {
  const device = press.device;
  const given =
    device.vendorId && device.productId
      ? names.nameOf({ vendorId: device.vendorId, productId: device.productId, guid: device.guid })
      : undefined;
  const button = press.kind === 'button' ? Number(/^JOY_BTN(\d+)$/.exec(press.input)?.[1]) : NaN;
  return {
    device: device.guid,
    deviceName: given ?? device.name.trim(),
    kind: press.kind,
    ...(Number.isInteger(button) ? { button } : {}),
    label:
      press.kind === 'button' && Number.isInteger(button)
        ? `Button ${button}`
        : press.kind === 'hat'
          ? 'a hat switch'
          : press.kind === 'axis'
            ? 'an axis'
            : 'a control',
  };
}
