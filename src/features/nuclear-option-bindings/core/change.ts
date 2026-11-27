import { sha256 } from '../../../core/files/fileStore';
import { changePreview } from '../../../core/files/preview';
import { registryValuePath } from '../../../core/files/registryValues';
import { gameRunning } from '../../../core/games';
import { err, ok, type Result } from '../../../core/result';
import type { ChangeRequest, ChangeResult, ChangeReview } from '../contract';
import { actionOf } from './actions';
import { editMap } from './edit';
import { textOfBinary } from './rewired';
import { GAME, GAME_NAME, REGISTRY_KEY, storedGameMap, type BindingsContext } from './view';

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
 * open is not the same as "closed": nothing is written on a guess.
 */
export async function whyBlocked(ctx: BindingsContext): Promise<string | undefined> {
  const list = await ctx.ports.processes.list();
  if (!list.ok) {
    return 'RigReady could not see which programs are running, so it cannot tell whether Nuclear Option is open.';
  }
  return (await gameRunning(ctx, ctx.games.get(GAME))) ? WHY_CLOSED : undefined;
}

const buttonsInWords = (buttons: number[]): string =>
  buttons.length === 0
    ? 'Not bound'
    : buttons.length === 1
      ? `Button ${buttons[0]}`
      : `Buttons ${buttons.slice(0, -1).join(', ')} and ${buttons.at(-1)}`;

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
}

async function plan(ctx: BindingsContext, request: ChangeRequest): Promise<Result<Plan>> {
  const stored = await storedGameMap(ctx, request.device);
  if (!stored.ok) return stored;
  const edited = editMap(stored.value.map, { actionId: request.actionId, button: request.button });
  if (!edited.ok) return edited;
  const current = Buffer.from(stored.value.text, 'utf8');
  return ok({
    valueName: stored.value.valueName,
    address: registryValuePath('HKCU', REGISTRY_KEY, stored.value.valueName),
    bytes: new Uint8Array(Buffer.from(edited.value.text, 'utf8')),
    // What the preview was made from: the value's name and its bytes.
    seen: sha256(`${stored.value.valueName}\n${sha256(current)}`),
    deviceName: stored.value.deviceName,
    actionName: actionOf(request.actionId).name,
    before: buttonsInWords(edited.value.before),
    after: request.button === null ? 'Not bound' : `Button ${request.button}`,
    same: edited.value.same,
    alsoOnButton: edited.value.alsoOnButton.map((id) => actionOf(id).name),
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
 * Writes one change: refused while the game runs, a backup first, and the value is read
 * back before anything is called done. The page calls this only from the review's Save.
 */
export async function applyChange(
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
      message:
        request.button === null
          ? `Nothing was changed: ${p.actionName} is not bound on ${p.deviceName}.`
          : `Nothing was changed: ${p.actionName} is already on ${p.after} of ${p.deviceName}.`,
    });
  }
  const group = ctx.ports.files.beginGroup(
    request.button === null
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
    back.value.value.toLowerCase() === Buffer.from(p.bytes).toString('hex') &&
    textOfBinary(back.value.value) !== undefined;
  if (!kept) {
    return err('nuclear-option.edit.notKept', 'The registry did not keep the change.');
  }
  return ok({
    changed: true,
    message:
      request.button === null
        ? `Saved: ${p.actionName} is no longer bound on ${p.deviceName}. Undo is on the Safety page.`
        : `Saved: ${p.actionName} is now on ${p.after} of ${p.deviceName}. Undo is on the Safety page.`,
  });
}
