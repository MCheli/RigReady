import { sha256 } from '../../../core/files/fileStore';
import { changePreview } from '../../../core/files/preview';
import { registryValuePath } from '../../../core/files/registryValues';
import { err, ok, type Result } from '../../../core/result';
import type {
  ChangeRequest,
  ChangeResult,
  ChangeReview,
  ClearDeviceRequest,
  ClearDeviceReview,
} from '../contract';
import { actionOf, bindingName, mapCategoryOf } from './actions';
import { gameKeyOf, keyName, MODIFIERS, modifierName } from './keys';
import { controlLabel } from '../../../core/bindings';
import { clearMapText, editMapText, type BindingEdit, type BoundTo } from './edit';
import {
  GAME,
  GAME_NAME,
  REGISTRY_KEY,
  axisNamesOf,
  KEYBOARD,
  storedControllerMaps,
  storedKeyboardMap,
  storedGameMap,
  type BindingsContext,
} from './view';

/**
 * One binding of a controller changed in what the game saved: shown first, then written
 * through FileStore, which copies the registry value to the automatic backups and lists the
 * change on the Safety page with Undo (src/core/files/registryValues.ts).
 *
 * The game reads its saved bindings when it starts and writes them from its own controls
 * screen, so the change is refused while the game runs.
 */

const WHY_CLOSED =
  'Close Nuclear Option first. The game reads its bindings when it starts and saves them itself, which would undo the change.';

/**
 * Why nothing can be written right now, when it cannot. Not knowing whether the game is
 * open is not the same as "closed": nothing is written on a guess. The one list of
 * programs that was read is the one that decides.
 */
export async function whyBlocked(ctx: BindingsContext): Promise<string | undefined> {
  const list = await ctx.ports.processes.list();
  if (!list.ok) {
    return 'RigReady could not see which programs are running, so it cannot tell whether Nuclear Option is open.';
  }
  const names = new Set((ctx.games.get(GAME)?.processes ?? []).map((name) => name.toLowerCase()));
  return list.value.some((p) => names.has(p.name.toLowerCase())) ? WHY_CLOSED : undefined;
}

/** One thing an action is on, in RigReady's words: "Button 3", "Y axis", "Y axis, reversed". */
function boundInWords(to: BoundTo, axes: string[]): string {
  if (to.kind === 'button') return `Button ${to.button}`;
  if (to.kind === 'key') {
    return [...to.modifiers.flatMap((m) => modifierName(m) ?? []), keyName(to.keyCode)].join(' + ');
  }
  const name = axes[to.index];
  const axis = name ? controlLabel({ kind: 'axis', axis: name }) : `Axis ${to.index}`;
  return to.invert ? `${axis}, reversed` : axis;
}

const inWords = (to: BoundTo[], axes: string[]): string => {
  if (to.length === 0) return 'Not bound';
  const words = to.map((t) => boundInWords(t, axes));
  return words.length === 1 ? words[0]! : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
};

interface Plan {
  valueName: string;
  address: string;
  bytes: Uint8Array;
  seen: string;
  deviceName: string;
  actionName: string;
  before: string;
  after: string;
  same: boolean;
  alsoOnButton: string[];
  /** The request clears the binding. */
  clears: boolean;
}

/**
 * The stored value's own bytes, when they are exactly the text the map was read from. Bytes
 * that are not UTF-8 read as text with a replacement character, and writing that text back
 * would lose them for good.
 */
async function exactBytes(
  ctx: BindingsContext,
  valueName: string,
  text: string
): Promise<Result<Buffer>> {
  const raw = await ctx.ports.registry.getValue('HKCU', REGISTRY_KEY, valueName);
  if (!raw.ok) return raw;
  const bytes = Buffer.from(text, 'utf8');
  if (raw.value?.type !== 'binary' || raw.value.value.toLowerCase() !== bytes.toString('hex')) {
    return err(
      'nuclear-option.edit.bytes',
      'The game’s saved bindings for this device hold bytes RigReady cannot write back exactly, so it does not change them. Change the binding in the game.'
    );
  }
  return ok(bytes);
}

async function plan(ctx: BindingsContext, request: ChangeRequest): Promise<Result<Plan>> {
  const onKeyboard = request.device === KEYBOARD;
  if (onKeyboard !== (request.key !== undefined)) {
    return err(
      'nuclear-option.edit.where',
      onKeyboard
        ? 'On the keyboard an action is bound to a key.'
        : 'A key is bound on the keyboard, not on a controller.'
    );
  }
  // The keyboard has a map for each tab of the game's controls screen: the action's own.
  const stored = onKeyboard
    ? await storedKeyboardMap(ctx, mapCategoryOf(actionOf(request.actionId)))
    : await storedGameMap(ctx, request.device);
  if (!stored.ok) return stored;
  const exact = await exactBytes(ctx, stored.value.valueName, stored.value.text);
  if (!exact.ok) return exact;
  const text = exact.value;
  // The keyboard has no axes to ask about.
  const asked = onKeyboard
    ? ok({ names: [] as string[], asked: true })
    : await axisNamesOf(ctx, request.device);
  if (!asked.ok) return asked;
  const axes = { value: asked.value.names };
  // Which number the game has for "Slider 1" depends on the controller's own list of axes.
  // Without it the number would be a guess from the usual order, so a new axis binding
  // waits for the controller; clearing one needs no number.
  if (request.axis && !asked.value.asked) {
    return err(
      'nuclear-option.edit.unplugged',
      'Plug this controller in to bind an axis: RigReady asks it which axes it has, and the game numbers them in that order.'
    );
  }
  // The key is asked for by the browser's name for it; the game knows it by two numbers.
  const numbered = (
    asked: NonNullable<ChangeRequest['key']>
  ): Result<{ element: number; keyCode: number; modifiers: number[] }> => {
    const known = gameKeyOf(asked.code);
    if (!known) {
      return err(
        'nuclear-option.edit.noKey',
        'RigReady does not know how the game numbers that key, so it does not bind it. Bind it in the game.'
      );
    }
    return ok({
      element: known.element,
      keyCode: known.keyCode,
      modifiers: [
        ...(asked.ctrl ? [MODIFIERS.ctrl] : []),
        ...(asked.alt ? [MODIFIERS.alt] : []),
        ...(asked.shift ? [MODIFIERS.shift] : []),
      ],
    });
  };
  let key: BindingEdit['key'];
  if (request.key === null) key = null;
  else if (request.key) {
    const known = numbered(request.key);
    if (!known.ok) return known;
    key = known.value;
  }
  let replaces: BindingEdit['replaces'];
  if (request.replaces) {
    if (request.key === undefined) {
      return err('nuclear-option.edit.where', 'Only a key change says which key it replaces.');
    }
    const known = numbered(request.replaces);
    if (!known.ok) return known;
    replaces = known.value;
  }
  // The axis is asked for by the name RigReady shows; the game knows it by its number.
  let axis: BindingEdit['axis'];
  if (request.axis === null) axis = null;
  else if (request.axis) {
    const wanted = request.axis.name.toUpperCase();
    const index = axes.value.findIndex((name) => name.toUpperCase() === wanted);
    if (index < 0) {
      return err(
        'nuclear-option.edit.noAxis',
        `This controller has no axis called ${request.axis.name}. Its axes are ${axes.value.join(', ')}.`
      );
    }
    axis = { index, invert: request.axis.invert };
  }
  const edit: BindingEdit = {
    actionId: request.actionId,
    ...(request.side ? { side: request.side } : {}),
    ...(request.button !== undefined ? { button: request.button } : {}),
    ...(axis !== undefined ? { axis } : {}),
    ...(key !== undefined ? { key } : {}),
    ...(replaces ? { replaces } : {}),
  };
  const edited = editMapText(stored.value.text, edit);
  if (!edited.ok) return edited;
  // A key taken off an action that has another is a change of what it is on, not a clear.
  const left = edited.value.after;
  const clears =
    request.button === null ||
    request.axis === null ||
    (request.key === null && (left === undefined || left.length === 0));
  const action = actionOf(request.actionId);
  return ok({
    valueName: stored.value.valueName,
    address: registryValuePath('HKCU', REGISTRY_KEY, stored.value.valueName),
    bytes: new Uint8Array(Buffer.from(edited.value.text, 'utf8')),
    // What the preview was made from and what it showed would be written: the value's name,
    // its bytes now, and the bytes it would become. An axis asked for by name is turned into
    // a number here; if that came out differently at Save (the controller unplugged
    // meanwhile), the bytes differ and the save is refused.
    seen: sha256(
      `${stored.value.valueName}\n${sha256(text)}\n${sha256(Buffer.from(edited.value.text, 'utf8'))}`
    ),
    deviceName: stored.value.deviceName,
    // One side of an axis action goes by the side's own name: "Zoom In".
    actionName: bindingName(action, request.side === undefined, request.side === '-' ? 1 : 0),
    before: inWords(edited.value.before, axes.value),
    after: clears
      ? 'Not bound'
      : axis
        ? boundInWords({ kind: 'axis', ...axis }, axes.value)
        : left
          ? inWords(left, [])
          : `Button ${request.button}`,
    same: edited.value.same,
    alsoOnButton: edited.value.alsoOn,
    clears,
  });
}

/** One change as it would be. Writes nothing. */
export async function reviewChange(
  ctx: BindingsContext,
  request: ChangeRequest
): Promise<Result<ChangeReview>> {
  const planned = await plan(ctx, request);
  if (!planned.ok) return planned;
  const p = planned.value;
  const preview = await changePreview(
    ctx.ports.files,
    [{ path: p.address, content: p.bytes }],
    () => `${GAME_NAME}’s saved bindings for ${p.deviceName} (registry)`
  );
  if (!preview.ok) return preview;
  const blocked = await whyBlocked(ctx);
  return ok({
    device: p.deviceName,
    action: p.actionName,
    before: p.before,
    after: p.after,
    same: p.same,
    alsoOnButton: p.alsoOnButton,
    ...(blocked ? { blocked } : {}),
    preview: preview.value,
    seen: p.seen,
  });
}

/**
 * One change at a time. A save replaces a controller's whole saved map, so two saves that
 * both planned from the same map would each pass the "is it still what was shown" check and
 * the later one would drop the earlier one's binding. Each save waits for the one before it
 * and then reads, checks and writes on its own.
 */
let queue: Promise<unknown> = Promise.resolve();

export function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  // The queue goes on whether this one succeeded or not.
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Writes one change: refused while the game runs, a backup first, and the value is read
 * back before anything is called done. The page calls this only from the review's Save.
 */
export function applyChange(
  ctx: BindingsContext,
  request: ChangeRequest
): Promise<Result<ChangeResult>> {
  return oneAtATime(() => applyNow(ctx, request));
}

async function applyNow(
  ctx: BindingsContext,
  request: ChangeRequest
): Promise<Result<ChangeResult>> {
  const blocked = await whyBlocked(ctx);
  if (blocked) return err('nuclear-option.edit.blocked', blocked);
  const planned = await plan(ctx, request);
  if (!planned.ok) return planned;
  const p = planned.value;
  // Worked out again from the value as it is now: when that is not what the preview was
  // made from, what the user approved may not hold.
  if (request.seen !== undefined && request.seen !== p.seen) {
    return err(
      'nuclear-option.edit.changed',
      'The game’s saved bindings changed after the change was shown, so nothing was written. Look at the change again.'
    );
  }
  if (p.same) {
    return ok({
      changed: false,
      message: p.clears
        ? `Nothing was changed: ${p.actionName} is not bound on ${p.deviceName}.`
        : `Nothing was changed: ${p.actionName} is already on ${p.after} of ${p.deviceName}.`,
    });
  }
  const group = ctx.ports.files.beginGroup(
    p.clears
      ? `${GAME_NAME} bindings: ${p.actionName} cleared on ${p.deviceName}`
      : `${GAME_NAME} bindings: ${p.actionName} bound to ${p.after} on ${p.deviceName}`
  );
  const written = await ctx.ports.files.write(p.address, p.bytes, {
    reason: `Change one binding in what ${GAME_NAME} saved in the registry`,
    group,
  });
  if (!written.ok) return written;
  // Read back through the registry port: only report what the registry really holds.
  const back = await ctx.ports.registry.getValue('HKCU', REGISTRY_KEY, p.valueName);
  if (!back.ok) return back;
  const kept =
    back.value?.type === 'binary' &&
    back.value.value.toLowerCase() === Buffer.from(p.bytes).toString('hex');
  if (!kept) {
    return err('nuclear-option.edit.notKept', 'The registry did not keep the change.');
  }
  return ok({
    changed: true,
    message: p.clears
      ? `Saved: ${p.actionName} is no longer bound on ${p.deviceName}. Undo is on the Safety page.`
      : `Saved: ${p.actionName} is now on ${p.after} of ${p.deviceName}. Undo is on the Safety page.`,
  });
}

// ---- Every binding of one controller cleared ----

interface ClearPlan {
  deviceName: string;
  /** The saved maps that have bindings, each with what it becomes. */
  writes: { valueName: string; address: string; bytes: Uint8Array }[];
  bindings: number;
  seen: string;
}

/**
 * A controller has one saved map for each tab of the game's controls screen (Game, Chat,
 * Mission Editor, Debug). Each one with bindings is emptied; when one of them cannot be,
 * none is: a controller half cleared is not what was asked for.
 */
async function planClear(ctx: BindingsContext, deviceId: string): Promise<Result<ClearPlan>> {
  const stored = await storedControllerMaps(ctx, deviceId);
  if (!stored.ok) return stored;
  const writes: ClearPlan['writes'] = [];
  const seen: string[] = [];
  let bindings = 0;
  for (const map of stored.value) {
    const exact = await exactBytes(ctx, map.valueName, map.text);
    if (!exact.ok) return exact;
    seen.push(`${map.valueName}\n${sha256(exact.value)}`);
    const cleared = clearMapText(map.text);
    if (!cleared.ok) return cleared;
    if (cleared.value.removed === 0) continue;
    bindings += cleared.value.removed;
    writes.push({
      valueName: map.valueName,
      address: registryValuePath('HKCU', REGISTRY_KEY, map.valueName),
      bytes: new Uint8Array(Buffer.from(cleared.value.text, 'utf8')),
    });
  }
  return ok({
    deviceName: stored.value[0]!.deviceName,
    writes,
    bindings,
    seen: sha256(seen.join('\n')),
  });
}

const bindingsInWords = (count: number): string =>
  count === 1 ? '1 binding' : `${count} bindings`;

/** Clearing one controller as it would be. Writes nothing. */
export async function reviewClearDevice(
  ctx: BindingsContext,
  request: ClearDeviceRequest
): Promise<Result<ClearDeviceReview>> {
  const planned = await planClear(ctx, request.device);
  if (!planned.ok) return planned;
  const p = planned.value;
  const preview = await changePreview(
    ctx.ports.files,
    p.writes.map((w) => ({ path: w.address, content: w.bytes })),
    () => `${GAME_NAME}’s saved bindings for ${p.deviceName} (registry)`
  );
  if (!preview.ok) return preview;
  const blocked = await whyBlocked(ctx);
  return ok({
    device: p.deviceName,
    bindings: p.bindings,
    same: p.bindings === 0,
    ...(blocked ? { blocked } : {}),
    preview: preview.value,
    seen: p.seen,
  });
}

/**
 * Takes every binding off one controller: refused while the game runs, a backup first, one
 * entry on the Safety page, and each value is read back before anything is called done.
 */
export function applyClearDevice(
  ctx: BindingsContext,
  request: ClearDeviceRequest
): Promise<Result<ChangeResult>> {
  return oneAtATime(() => clearNow(ctx, request));
}

async function clearNow(
  ctx: BindingsContext,
  request: ClearDeviceRequest
): Promise<Result<ChangeResult>> {
  const blocked = await whyBlocked(ctx);
  if (blocked) return err('nuclear-option.edit.blocked', blocked);
  const planned = await planClear(ctx, request.device);
  if (!planned.ok) return planned;
  const p = planned.value;
  if (request.seen !== undefined && request.seen !== p.seen) {
    return err(
      'nuclear-option.edit.changed',
      'The game’s saved bindings changed after the change was shown, so nothing was written. Look at the change again.'
    );
  }
  if (p.bindings === 0) {
    return ok({
      changed: false,
      message: `Nothing was changed: nothing is bound on ${p.deviceName}.`,
    });
  }
  const group = ctx.ports.files.beginGroup(
    `${GAME_NAME} bindings: all ${bindingsInWords(p.bindings)} cleared on ${p.deviceName}`
  );
  let done = 0;
  // Said with any failure once a value was written: the controller is then partly cleared.
  const partly = (message: string): string =>
    done === 0
      ? message
      : `${message} Part of ${p.deviceName}’s bindings was already cleared; Undo on the Safety page puts them back.`;
  for (const write of p.writes) {
    const written = await ctx.ports.files.write(write.address, write.bytes, {
      reason: `Clear a controller’s bindings in what ${GAME_NAME} saved in the registry`,
      group,
    });
    if (!written.ok) return err(written.error.code, partly(written.error.message));
    done++;
    const back = await ctx.ports.registry.getValue('HKCU', REGISTRY_KEY, write.valueName);
    if (!back.ok) return err(back.error.code, partly(back.error.message));
    const kept =
      back.value?.type === 'binary' &&
      back.value.value.toLowerCase() === Buffer.from(write.bytes).toString('hex');
    if (!kept) {
      return err('nuclear-option.edit.notKept', partly('The registry did not keep the change.'));
    }
  }
  return ok({
    changed: true,
    message: `Saved: ${bindingsInWords(p.bindings)} cleared on ${p.deviceName}. Undo is on the Safety page.`,
  });
}
