import type { DisplayInfo, DisplayTarget, Rotation } from '../../../shared/models';

/**
 * "Known to work on this PC": when a monitor change may be applied without the
 * "Keep this monitor layout?" question.
 *
 * The question and its countdown exist because a change can leave nobody able to see a
 * screen; the countdown then undoes it. Make ready and Stand down skip the question only
 * for a change this PC has shown to be harmless, and that means exactly this:
 *
 * 1. The same change (the same monitors asked to be on or off, in the same places, at the
 *    same sizes, rotations and refresh rates, with the same main display) was applied
 *    before,
 * 2. with exactly the same monitors connected as now, and every monitor the change does
 *    not mention on or off as it is now,
 * 3. a person then pressed "Keep it" in RigReady's own window (an assistant's keep and a
 *    countdown that was merely replaced by a newer change do not count),
 * 4. and a read of the monitors right after that showed them as the change asked.
 *
 * There is one other way to the same knowledge: "Replace with the monitors as they are
 * now" on the Monitors page (LayoutApplier.seen). It meets the four points like this:
 *
 * 1. The change it records is the one Make ready and Stand down would make with that
 *    layout (the targets `analyzeLayout` gives for it), and those targets are exactly
 *    the arrangement the monitors are in at that moment. A proof says where the monitors
 *    end up, not where they start (`proofOf` takes only which monitors are connected and
 *    the on or off of the ones the change does not mention from the monitors it is given),
 *    so "applied before and kept" and "is the arrangement now and was chosen" describe the
 *    same end: the same monitors, on and off, in the same places, sizes, rotations and
 *    refresh rates, with the same main display.
 * 2. It is recorded with the monitors connected at that moment, and only those count.
 * 3. A person chose it in RigReady's own window while looking at those monitors, which is
 *    what "Keep it" proves: they can see a screen and the window on it. Nothing was
 *    applied, so there was nothing to undo. An assistant's Replace does not count, and
 *    neither does one made while a question is open (that arrangement nobody has answered).
 * 4. The monitors are read again after the layout is saved, and nothing is recorded unless
 *    the read shows them exactly as the targets say, with the same monitors connected.
 *
 * Only Replace counts. A layout saved new is asked about once, as before; and "New
 * layout" could not count anyway, since it switches off monitors that are on now.
 *
 * Such a kept change is written to `<data root>/displays/proven.json` (ProvenStore). A
 * layout that is edited afterwards, a monitor that is added, removed or moved to another
 * connector, or anything this module cannot work out for certain, is simply not found
 * there, and the question is asked again. When in doubt, the question stays.
 */
export interface Proof {
  /** Every connected monitor, by the identity that follows it. Sorted. */
  monitors: string[];
  /** One line per monitor the change sets: what it was asked to be. Sorted. */
  asked: string[];
  /** Connected monitors the change does not mention: on or off, as they were. Sorted. */
  others: string[];
}

const sideways = (r: Rotation): boolean => r === 90 || r === 270;

/**
 * What a monitor is known by here. A USB screen keeps its USB serial on any port, so that
 * is used when it is the only connected monitor with it; otherwise the id (the model plus
 * the connector it is plugged into).
 */
export function monitorKeys(connected: DisplayInfo[]): Map<string, string> {
  const serials = new Map<string, number>();
  for (const d of connected) {
    if (d.usbSerial) serials.set(d.usbSerial, (serials.get(d.usbSerial) ?? 0) + 1);
  }
  return new Map(
    connected.map((d) => [
      d.id.toLowerCase(),
      d.usbSerial && serials.get(d.usbSerial) === 1
        ? `usb:${d.usbSerial}`
        : `id:${d.id.toLowerCase()}`,
    ])
  );
}

/**
 * The change `targets` would make with these monitors connected, in a form two of which
 * can be compared. Undefined when it cannot be said for certain what the change comes to:
 * a monitor it names is not connected, or a monitor that is off would come on at a size
 * the change does not give.
 */
export function proofOf(targets: DisplayTarget[], connected: DisplayInfo[]): Proof | undefined {
  const keys = monitorKeys(connected);
  const byId = new Map(connected.map((d) => [d.id.toLowerCase(), d]));
  const asked: string[] = [];
  const mentioned = new Set<string>();
  for (const target of targets) {
    const id = target.id.toLowerCase();
    const have = byId.get(id);
    const key = keys.get(id);
    if (!have || !key || mentioned.has(id)) return undefined;
    mentioned.add(id);
    if (!target.enabled) {
      asked.push(`${key}|off`);
      continue;
    }
    let width = target.width;
    let height = target.height;
    if (width === undefined || height === undefined) {
      // No size given: the monitor keeps the one it has, which is only known while it is on.
      if (!have.enabled || have.width <= 0 || have.height <= 0) return undefined;
      const turn = sideways(target.rotation) !== sideways(have.rotation);
      width = turn ? have.height : have.width;
      height = turn ? have.width : have.height;
    }
    const rate = target.refreshHz !== undefined ? `${Math.round(target.refreshHz)}Hz` : 'any rate';
    asked.push(
      [
        key,
        'on',
        target.primary ? 'main' : 'not main',
        `${target.x},${target.y}`,
        `${width}x${height}`,
        `${target.rotation}deg`,
        rate,
      ].join('|')
    );
  }
  if (asked.length === 0) return undefined;
  const others = connected
    .filter((d) => !mentioned.has(d.id.toLowerCase()))
    .map((d) => `${keys.get(d.id.toLowerCase())}|${d.enabled ? 'on' : 'off'}`);
  return {
    monitors: [...keys.values()].sort(),
    asked: asked.sort(),
    others: others.sort(),
  };
}

const same = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((line, i) => line === b[i]);

export function sameProof(a: Proof, b: Proof): boolean {
  return same(a.monitors, b.monitors) && same(a.asked, b.asked) && same(a.others, b.others);
}

/**
 * Are the monitors, read back, as the change asked? One line per thing that is not; empty
 * when they are. This is the read-back behind every "applied" that is said without a
 * question, and behind every change remembered as known to work.
 */
export function notAsAsked(targets: DisplayTarget[], now: DisplayInfo[]): string[] {
  const byId = new Map(now.map((d) => [d.id.toLowerCase(), d]));
  const lines: string[] = [];
  for (const target of targets) {
    const have = byId.get(target.id.toLowerCase());
    const name = target.name;
    if (!have) {
      lines.push(`${name} is not connected`);
      continue;
    }
    if (!target.enabled) {
      if (have.enabled) lines.push(`${name} is on, asked off`);
      continue;
    }
    if (!have.enabled) {
      lines.push(`${name} is off, asked on`);
      continue;
    }
    if (have.rotation !== target.rotation) {
      lines.push(`${name} is rotated ${have.rotation}°, asked ${target.rotation}°`);
    }
    if (
      target.width !== undefined &&
      target.height !== undefined &&
      (have.width !== target.width || have.height !== target.height)
    ) {
      lines.push(`${name} is ${have.width}x${have.height}, asked ${target.width}x${target.height}`);
    }
    if (have.x !== target.x || have.y !== target.y) {
      lines.push(`${name} is at ${have.x},${have.y}, asked ${target.x},${target.y}`);
    }
    if (have.primary !== target.primary) {
      lines.push(
        target.primary ? `${name} is not the main display` : `${name} is the main display`
      );
    }
    if (
      target.refreshHz !== undefined &&
      have.refreshHz !== undefined &&
      Math.abs(have.refreshHz - target.refreshHz) >= 0.5
    ) {
      lines.push(`${name} runs at ${have.refreshHz} Hz, asked ${target.refreshHz} Hz`);
    }
  }
  return lines;
}
