import { sameGuid } from '../../../core/directInput';
import { sha256 } from '../../../core/files/fileStore';
import { changePreview } from '../../../core/files/preview';
import type { DeviceNames } from '../../../core/names';
import { err, ok, type Result } from '../../../core/result';
import type {
  ClearGoneRequest,
  ClearGoneResult,
  ClearGoneReview,
  Device,
  GoneDevice,
  GoneView,
  SetView,
} from '../contract';
import { refuseWhenOff, whyBlocked } from './change';
import { RECORD_BYTES, encodeControlsFile, parseControlsFile } from './controlsFile';
import { KEPT_BYTES } from './edit';
import { setView, type BindingsContext } from './view';

/**
 * Cleaning up the bindings of controllers that are gone: a set of iRacing bindings often
 * still names a wheel, pedals or a button box that was sold or swapped long ago, and every
 * one of those bindings is dead weight in iRacing's Options and in RigReady's lists.
 *
 * A controller the set names that is not plugged in under that id is one of four things
 * (`GoneVerdict` in the contract), and only "gone" is ever offered:
 * - moved: a controller of the same model is plugged in under an id the file does not
 *   name. That is Windows giving the controller a new id, and the answer is the id repair
 *   on the racing feature's iRacing page, never clearing.
 * - unplugged: not plugged in, but RigReady knows the model as the owner's (it saw one on
 *   this PC, or the owner named one or said what it is: `DeviceNames.known`), or another
 *   controller of the model is plugged in. Unplugged today is not gone.
 * - unknown: RigReady cannot tell (Windows gave no list of controllers, the product id
 *   says no model, or the devices history cannot be read). Not knowing is not "gone".
 * - gone: none of the above.
 *
 * The user ticks the gone controllers one by one. The change is shown first, written
 * through FileStore (a backup first, one entry on the Safety page), behind the same switch
 * as changing one binding, and refused while iRacing runs. Each cleared record gets what
 * iRacing itself has for an action that was never bound: bytes +8 to +67 all zero. The
 * first two fields of a record, every other record and the rest of the file stay byte for
 * byte. joyCalib.yaml is not touched: a calibration of a controller that is not there does
 * nothing.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "10 November 2026", or nothing for a time that is not one. */
function dayOf(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

const WHY = {
  moved:
    'A controller of this model is plugged in with a new Windows id. Point iRacing at the new id instead of clearing: its bindings then work again.',
  twin: 'Another controller of this model is plugged in, so these bindings may well be yours. RigReady leaves them alone.',
  noList:
    'Windows did not list the controllers, so RigReady cannot tell whether this one is plugged in. It leaves its bindings alone.',
  noModel:
    'RigReady cannot tell which model of controller this is, so it leaves its bindings alone.',
  noHistory:
    'RigReady cannot read its list of the devices it has seen, so it cannot tell whether this one is yours. It leaves its bindings alone.',
  gone: 'Not plugged in, and RigReady has never seen it on this PC. If it is yours and only unplugged, leave it.',
};

function unpluggedWhy(lastSeen: string | undefined): string {
  const day = dayOf(lastSeen);
  const seen = day ? `RigReady last saw it on this PC on ${day}` : 'RigReady knows it as yours';
  return `Unplugged today. ${seen}, so its bindings stay. If Windows gives it a new id when you plug it in, point iRacing at the new id on the iRacing page.`;
}

/** What one controller of the set is, when it is not plugged in under its id. */
function verdictOf(
  device: Device,
  live: { vendorId: string; productId: string }[] | undefined,
  names: DeviceNames
): Pick<GoneDevice, 'verdict' | 'why'> {
  if (device.state === 'moved') return { verdict: 'moved', why: WHY.moved };
  if (device.state === 'unknown' || !live) return { verdict: 'unknown', why: WHY.noList };
  const { vendorId, productId } = device;
  if (!vendorId || !productId) return { verdict: 'unknown', why: WHY.noModel };
  const same = (d: { vendorId: string; productId: string }): boolean =>
    d.vendorId.toUpperCase() === vendorId.toUpperCase() &&
    d.productId.toUpperCase() === productId.toUpperCase();
  if (live.some(same)) return { verdict: 'unplugged', why: WHY.twin };
  if (!names.known) return { verdict: 'unknown', why: WHY.noHistory };
  const known = names.known({ vendorId, productId });
  if (known) return { verdict: 'unplugged', why: unpluggedWhy(known.lastSeen) };
  return { verdict: 'gone', why: WHY.gone };
}

/** The set as the page shows it, and the controllers of it that are not plugged in. */
async function survey(
  ctx: BindingsContext,
  set: string,
  names: DeviceNames
): Promise<Result<{ view: SetView; gone: GoneView }>> {
  const view = await setView(ctx, set, names);
  if (!view.ok) return view;
  const started = await ctx.ports.input.start();
  const live = started.ok ? started.value : undefined;
  const devices: GoneDevice[] = [];
  for (const device of view.value.devices) {
    if (device.kind !== 'controller' || device.state === 'connected') continue;
    const bindings = view.value.actions
      .filter((a) => a.binding?.device === device.key)
      .map((a) => ({ action: a.id, name: a.name, input: a.binding!.input }));
    devices.push({
      key: device.key,
      name: device.name,
      ...(device.givenName ? { givenName: device.givenName } : {}),
      ...(device.vendorId ? { vendorId: device.vendorId } : {}),
      ...(device.productId ? { productId: device.productId } : {}),
      ...verdictOf(device, live, names),
      bindings,
    });
  }
  return ok({ view: view.value, gone: { set: view.value.set, devices } });
}

/** The controllers of one set that are not plugged in, and what RigReady makes of each. Reads only. */
export async function goneDevices(
  ctx: BindingsContext,
  set: string,
  names: DeviceNames
): Promise<Result<GoneView>> {
  const surveyed = await survey(ctx, set, names);
  return surveyed.ok ? ok(surveyed.value.gone) : surveyed;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, i) => value === b[i]);

function refuse(code: string, message: string, detail?: string): Result<never> {
  return err(`iracing-bindings.cleanup.${code}`, message, detail);
}

/**
 * The file with the bindings of these controllers cleared: every record bound to an axis or
 * a button of one of them gets bytes +8 to +67 set to zero, which is what iRacing has for an
 * action that was never bound (an axis action as much as a button action). Bytes in, bytes
 * out; nothing touches a disk. The result is checked as a stranger's file would be: the same
 * length, no byte changed outside those records' binding bytes, and a file that reads back
 * with exactly those records unbound and every other one as it was. A record RigReady does
 * not read in full is left as it is.
 */
export function clearDevices(
  bytes: Uint8Array,
  devices: readonly string[]
): Result<{ bytes: Uint8Array; actions: string[] }> {
  const parsed = parseControlsFile(bytes);
  if (!parsed.ok) return parsed;
  if (!sameBytes(encodeControlsFile(parsed.value), bytes)) {
    return refuse(
      'roundTrip',
      'RigReady does not read this file exactly, so it will not change it. Clear the bindings in iRacing.'
    );
  }
  const records = parsed.value.records;
  const ofDevice = (r: (typeof records)[number]): boolean =>
    r.understood &&
    (r.binding.kind === 'axis' || r.binding.kind === 'button') &&
    devices.some((d) => sameGuid(d, (r.binding as { instanceGuid: string }).instanceGuid));
  const chosen = records.filter(ofDevice);
  if (chosen.length === 0) {
    return refuse('nothing', 'Nothing in this set is bound to those controllers any more.');
  }
  for (const record of chosen) {
    if (records.filter((r) => r.action === record.action).length > 1) {
      return refuse(
        'twice',
        `${record.action} is in the file more than once, so RigReady will not change it.`
      );
    }
  }
  const out = bytes.slice();
  const ranges = chosen.map((r) => [r.offset + KEPT_BYTES, r.offset + RECORD_BYTES] as const);
  for (const [from, to] of ranges) out.fill(0, from, to);

  // Checked as a stranger's file would be, not trusted because it was just made.
  const inside = (i: number): boolean => ranges.some(([from, to]) => i >= from && i < to);
  if (out.length !== bytes.length) {
    return refuse('length', 'The file would have changed its length. Nothing was changed.');
  }
  for (let i = 0; i < out.length; i++) {
    if (!inside(i) && out[i] !== bytes[i]) {
      return refuse('outside', 'RigReady would have changed more than those bindings.');
    }
  }
  const again = parseControlsFile(out);
  if (!again.ok || again.value.records.length !== records.length) {
    return refuse('reread', 'The changed file did not read back. Nothing was changed.');
  }
  for (let i = 0; i < records.length; i++) {
    const now = again.value.records[i]!;
    const was = records[i]!;
    const cleared = chosen.includes(was);
    const fine =
      now.action === was.action &&
      now.offset === was.offset &&
      (cleared
        ? now.understood &&
          now.binding.kind === 'none' &&
          sameBytes(now.data.subarray(0, KEPT_BYTES), was.data.subarray(0, KEPT_BYTES))
        : sameBytes(now.data, was.data));
    if (!fine) return refuse('reread', 'The changed file did not read back. Nothing was changed.');
  }
  return ok({ bytes: out, actions: chosen.map((r) => r.action) });
}

interface Plan {
  review: Omit<ClearGoneReview, 'preview' | 'blocked'>;
  file: string;
  bytes: Uint8Array;
  names: string[];
}

async function plan(
  ctx: BindingsContext,
  request: ClearGoneRequest,
  names: DeviceNames
): Promise<Result<Plan>> {
  const surveyed = await survey(ctx, request.set, names);
  if (!surveyed.ok) return surveyed;
  const { view, gone } = surveyed.value;
  const chosen: GoneDevice[] = [];
  for (const key of new Set(request.devices.map((d) => d.toUpperCase()))) {
    const device = gone.devices.find((d) => sameGuid(d.key, key));
    if (!device) {
      return refuse('notInSet', 'That controller is not one of this set’s that are unplugged.');
    }
    // Decided again here, whatever the page or an assistant asked for: only a controller
    // that is gone is ever cleared.
    if (device.verdict !== 'gone') {
      return refuse('notGone', `${device.givenName ?? device.name}: ${device.why}`);
    }
    chosen.push(device);
  }
  const file = view.set.file;
  const bytes = await ctx.ports.files.readBytes(file);
  if (!bytes.ok) {
    return err('iracing-bindings.read', `RigReady could not read ${file}.`, bytes.error.message);
  }
  const cleared = clearDevices(
    bytes.value,
    chosen.map((d) => d.key)
  );
  if (!cleared.ok) return cleared;
  const done = new Set(cleared.value.actions);
  const bindings = chosen.flatMap((d) =>
    d.bindings.filter((b) => done.has(b.action)).map((b) => ({ device: d.key, ...b }))
  );
  return ok({
    review: {
      set: view.set,
      devices: chosen.map((d) => ({
        key: d.key,
        name: d.givenName ?? d.name,
        count: bindings.filter((b) => b.device === d.key).length,
      })),
      bindings,
      seen: sha256(bytes.value),
    },
    file,
    bytes: cleared.value.bytes,
    names: chosen.map((d) => d.givenName ?? d.name),
  });
}

/** Which bindings clearing the chosen gone controllers would remove, and the file change. Writes nothing. */
export async function reviewClearGone(
  ctx: BindingsContext,
  request: ClearGoneRequest,
  names: DeviceNames,
  env?: NodeJS.ProcessEnv
): Promise<Result<ClearGoneReview>> {
  const on = refuseWhenOff(env);
  if (!on.ok) return on;
  const planned = await plan(ctx, request, names);
  if (!planned.ok) return planned;
  const preview = await changePreview(ctx.ports.files, [
    { path: planned.value.file, content: planned.value.bytes },
  ]);
  if (!preview.ok) return preview;
  const blocked = await whyBlocked(ctx);
  return ok({ ...planned.value.review, ...(blocked ? { blocked } : {}), preview: preview.value });
}

const bindingsWord = (n: number): string => (n === 1 ? '1 binding' : `${n} bindings`);

/**
 * Clears the bindings of the chosen gone controllers in the set's controls.cfg: refused
 * while the switch is off and while iRacing runs, when the file changed since the review,
 * and for any controller that is not gone. A backup first, and the file is read back before
 * anything is called done.
 */
export async function clearGone(
  ctx: BindingsContext,
  request: ClearGoneRequest,
  names: DeviceNames,
  env?: NodeJS.ProcessEnv
): Promise<Result<ClearGoneResult>> {
  const on = refuseWhenOff(env);
  if (!on.ok) return on;
  const blocked = await whyBlocked(ctx);
  if (blocked) return err('iracing-bindings.edit.blocked', blocked);
  const planned = await plan(ctx, request, names);
  if (!planned.ok) return planned;
  const { review, file, bytes } = planned.value;
  if (request.seen !== undefined && request.seen !== review.seen) {
    return refuse(
      'changed',
      'controls.cfg changed after the change was shown, so nothing was written. Look at it again.'
    );
  }
  const count = review.bindings.length;
  const who = planned.value.names.join(', ');
  const where = review.set.general ? 'for all cars' : `for ${review.set.name}`;
  const group = ctx.ports.files.beginGroup(
    `iRacing bindings ${where}: cleared ${bindingsWord(count)} of ${who}`
  );
  const written = await ctx.ports.files.write(file, bytes, {
    reason: 'Clear the bindings of controllers that are gone in controls.cfg',
    group,
  });
  if (!written.ok) return written;
  // Read back: only report what is really on disk.
  const back = await ctx.ports.files.readBytes(file);
  if (!back.ok) return back;
  if (!sameBytes(back.value, bytes)) {
    return refuse('notKept', 'controls.cfg did not keep the change.');
  }
  return ok({
    cleared: count,
    message: `Cleared ${bindingsWord(count)} of ${who} in iRacing’s file ${where}. Undo is on the Safety page.`,
    file,
  });
}
