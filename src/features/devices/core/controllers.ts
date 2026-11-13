import type { InputDevice } from '../../../shared/models';

/**
 * Which game controller is which, across a plug or unplug.
 *
 * RigReady numbers the controllers by their place in a list sorted by name, so the number of
 * a controller changes when another one comes or goes, and a number that belonged to one
 * controller can belong to another a moment later. A controller is therefore known by its
 * DirectInput GUID, never by its number alone: what was learnt about one (its name, the
 * range its axes reached, its lines in the activity list) must not pass to the next one
 * that gets the same number.
 */

type Identity = Pick<InputDevice, 'index' | 'guid' | 'name'>;

const guidOf = (controller: Pick<InputDevice, 'guid'>): string => controller.guid.toUpperCase();

/** True when both are the same controller: the same GUID, or without one the same place and name. */
export function sameController(a: Identity, b: Identity): boolean {
  if (a.guid && b.guid) return guidOf(a) === guidOf(b);
  return !a.guid && !b.guid && a.index === b.index && a.name === b.name;
}

/** The device (of an overview) a controller belongs to, and its place among that device's controllers. */
export function ownerOf<T extends { controllers: readonly Identity[] }>(
  devices: readonly T[],
  controller: Identity
): { device: T; position: number } | undefined {
  for (const device of devices) {
    const position = device.controllers.findIndex((c) => sameController(c, controller));
    if (position >= 0) return { device, position };
  }
  return undefined;
}

/** A line that differs whenever the list of controllers does: who sits at which number. */
export function controllersSignature(list: readonly InputDevice[]): string {
  return JSON.stringify(
    list.map((d) => [d.index, guidOf(d), d.name, d.numAxes, d.numButtons, d.numHats])
  );
}

export interface ControllerChanges {
  /** True when the two lists differ at all: a controller came, went, moved or changed. */
  changed: boolean;
  /**
   * The numbers at which another controller sits now, or none any more. What was learnt
   * about the controller that had the number is void for whoever has it next.
   */
  vacated: number[];
}

/** What changed between the list of controllers a screen had and the list as it is now. */
export function controllerChanges(
  previous: readonly InputDevice[],
  next: readonly InputDevice[]
): ControllerChanges {
  const vacated = previous
    .filter((before) => {
      const now = next.find((d) => d.index === before.index);
      return !now || !sameController(before, now);
    })
    .map((d) => d.index);
  return {
    changed: controllersSignature(previous) !== controllersSignature(next),
    vacated,
  };
}
