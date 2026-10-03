import type { DisplayInfo, DisplayTarget } from '../../shared/models';

/**
 * How a monitor saved in a layout (or a setup, or a DCS screen setup) is found again
 * among the monitors connected now. Every feature that stores monitors uses this, so
 * they all agree on which screen is which.
 *
 * A monitor's id is its device interface path, e.g.
 * `\\?\display#reg0319#a&2c1ac5a9&0&uid256#{e6f07b5f-...}`: the EDID model code
 * (`reg0319`) plus the instance of the connector it is plugged into. Windows' own
 * numbering (\\.\DISPLAY5, "monitor 2") changes whenever monitors are turned on or off;
 * the id does not, but it can change when the cable moves to another connector.
 *
 * In order:
 * 1. USB serial: a USB screen (DisplayLink) hangs off a USB device with its own serial
 *    number. It is the same on every USB port, so it wins over everything else.
 * 2. Id: the same model on the same connector.
 * 3. EDID serial, when exactly one connected monitor of that model has it.
 * 4. Model, when it is the only one of its model left on both sides.
 * Identical monitors without any serial that all moved cannot be told apart and are
 * reported as such (`lookalikes`).
 */

/** The EDID manufacturer and product code from a monitor id, upper case ("DELD139"). */
export function modelOf(id: string): string | undefined {
  const parts = id.toLowerCase().split('#');
  const model = parts[0]?.endsWith('display') ? parts[1] : undefined;
  return model ? model.toUpperCase() : undefined;
}

export type MatchKind = 'usb' | 'id' | 'serial' | 'model';

export interface MonitorMatch<T> {
  expected: T;
  /** The connected monitor, when one was found. */
  actual?: DisplayInfo;
  how?: MatchKind;
  /** Not found, and this many unclaimed monitors of the same model are connected. */
  lookalikes: number;
}

type Expected = Pick<DisplayTarget, 'id'> & Partial<Pick<DisplayTarget, 'serial' | 'usbSerial'>>;

const modelOfActual = (d: DisplayInfo): string | undefined =>
  (d.edid ?? modelOf(d.id))?.toUpperCase();

/** Pairs every expected monitor with the connected one it is, in the order given. */
export function matchMonitors<T extends Expected>(
  expected: T[],
  actual: DisplayInfo[]
): MonitorMatch<T>[] {
  const claimed = new Set<string>();
  const matches: MonitorMatch<T>[] = expected.map((want) => ({ expected: want, lookalikes: 0 }));
  const claim = (match: MonitorMatch<T>, found: DisplayInfo, how: MatchKind): void => {
    match.actual = found;
    match.how = how;
    claimed.add(found.id);
  };
  const free = (): DisplayInfo[] => actual.filter((d) => !claimed.has(d.id));
  const open = (): MonitorMatch<T>[] => matches.filter((m) => !m.actual);

  // 1. The USB device a USB screen hangs off: the same on any port.
  for (const match of open()) {
    const serial = match.expected.usbSerial;
    if (!serial) continue;
    const model = modelOf(match.expected.id);
    const found = free().filter(
      (d) => d.usbSerial === serial && (!model || modelOfActual(d) === model)
    );
    if (found.length === 1) claim(match, found[0]!, 'usb');
  }

  // 2. The same connector. A screen known by its USB serial is never taken for the one
  //    that now sits on its old connector.
  const byId = new Map(actual.map((d) => [d.id.toLowerCase(), d]));
  for (const match of open()) {
    const found = byId.get(match.expected.id.toLowerCase());
    if (!found || claimed.has(found.id)) continue;
    const want = match.expected.usbSerial;
    if (want && found.usbSerial && found.usbSerial !== want) continue;
    claim(match, found, 'id');
  }

  // 3. An EDID serial that only one connected monitor of the model has. Panels that all
  //    report the same serial ("1") are not identified by it.
  for (const match of open()) {
    const serial = match.expected.serial;
    const model = modelOf(match.expected.id);
    if (!serial || !model) continue;
    const sameSerial = actual.filter((d) => modelOfActual(d) === model && d.serial === serial);
    const wanted = matches.filter(
      (m) => modelOf(m.expected.id) === model && m.expected.serial === serial
    );
    if (sameSerial.length === 1 && wanted.length === 1 && !claimed.has(sameSerial[0]!.id)) {
      claim(match, sameSerial[0]!, 'serial');
    }
  }

  // 4. A model that is unique among what is left on both sides.
  for (const match of open()) {
    const model = modelOf(match.expected.id);
    if (!model) continue;
    const sameModelActual = free().filter((d) => modelOfActual(d) === model);
    const sameModelExpected = open().filter((m) => modelOf(m.expected.id) === model);
    if (sameModelActual.length === 1 && sameModelExpected.length === 1) {
      claim(match, sameModelActual[0]!, 'model');
    } else {
      match.lookalikes = sameModelActual.length;
    }
  }
  return matches;
}

/** The connected monitor a stored one is, or undefined. For features that store one monitor at a time. */
export function findMonitor(
  stored: Expected,
  others: Expected[],
  actual: DisplayInfo[]
): DisplayInfo | undefined {
  const all = others.some((o) => o === stored) ? others : [stored, ...others];
  return matchMonitors(all, actual).find((m) => m.expected === stored)?.actual;
}
