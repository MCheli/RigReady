import type { DisplayInfo, DisplayTarget } from '../../../shared/models';

/**
 * How a monitor saved in a layout is found again among the monitors connected now.
 *
 * A monitor's id is its device interface path, e.g.
 * `\\?\display#reg0319#a&2c1ac5a9&0&uid256#{e6f07b5f-...}`: the EDID model code
 * (`reg0319`) plus the instance of the connector it is plugged into. Windows' own
 * numbering (\\.\DISPLAY5, "monitor 2") changes whenever monitors are turned on or off;
 * this id does not, so identical monitors keep their identity as long as each stays on
 * its connector.
 *
 * When the id is not found (the cable moved to another port) a monitor is still found
 * if it is the only one of its model on both sides. Identical monitors that all moved
 * cannot be told apart and are reported as such.
 */

/** The EDID manufacturer and product code from a monitor id, upper case ("DELD139"). */
export function modelOf(id: string): string | undefined {
  const parts = id.toLowerCase().split('#');
  const model = parts[0]?.endsWith('display') ? parts[1] : undefined;
  return model ? model.toUpperCase() : undefined;
}

export type MatchKind = 'id' | 'model';

export interface MonitorMatch<T> {
  expected: T;
  /** The connected monitor, when one was found. */
  actual?: DisplayInfo;
  how?: MatchKind;
  /** Not found by id, and this many unclaimed monitors of the same model are connected. */
  lookalikes: number;
}

/** Pairs every expected monitor with the connected one it is, in the order given. */
export function matchMonitors<T extends Pick<DisplayTarget, 'id'>>(
  expected: T[],
  actual: DisplayInfo[]
): MonitorMatch<T>[] {
  const byId = new Map(actual.map((d) => [d.id.toLowerCase(), d]));
  const claimed = new Set<string>();
  const matches: MonitorMatch<T>[] = expected.map((want) => {
    const found = byId.get(want.id.toLowerCase());
    if (found && !claimed.has(found.id)) {
      claimed.add(found.id);
      return { expected: want, actual: found, how: 'id', lookalikes: 0 };
    }
    return { expected: want, lookalikes: 0 };
  });

  // Second pass: a model that is unique among what is left on both sides.
  const modelOfActual = (d: DisplayInfo): string | undefined =>
    (d.edid ?? modelOf(d.id))?.toUpperCase();
  const leftActual = actual.filter((d) => !claimed.has(d.id));
  const leftExpected = matches.filter((m) => !m.actual);
  for (const match of leftExpected) {
    const model = modelOf(match.expected.id);
    if (!model) continue;
    const sameModelActual = leftActual.filter(
      (d) => !claimed.has(d.id) && modelOfActual(d) === model
    );
    const sameModelExpected = leftExpected.filter(
      (m) => !m.actual && modelOf(m.expected.id) === model
    );
    if (sameModelActual.length === 1 && sameModelExpected.length === 1) {
      match.actual = sameModelActual[0]!;
      match.how = 'model';
      claimed.add(match.actual.id);
    } else {
      match.lookalikes = sameModelActual.length;
    }
  }
  return matches;
}
