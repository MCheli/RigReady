import type { UnlistedController, WheelStatus } from '../../contract';

/**
 * What the Wheel page and the wheel card on the Racing page say first: which of five cases
 * this PC is in, and the words for it. One place, so the two screens cannot disagree.
 *
 * The words say only what RigReady knows. With nothing it knows connected it says so, and
 * never "no wheel base on this PC": a base of a model it does not know may be plugged in.
 */

export type WheelHeadState =
  /** A base is connected: one RigReady knows, or one the user added. */
  | 'connected'
  /** No base shown, but a connected controller looks like a wheel base of an unknown model. */
  | 'seen'
  /** The base the user added is not connected. */
  | 'awaited'
  /** A maker's software or traces of a base are on this PC, and the base is not connected. */
  | 'missing'
  /** Nothing RigReady knows: no base, no wheel software, no trace of one. */
  | 'none';

export interface WheelHead {
  state: WheelHeadState;
  title: string;
  /** In the `seen` state: the controller that looks like a wheel base. */
  seen?: UnlistedController;
}

export function wheelHead(status: WheelStatus): WheelHead {
  if (status.connected) return { state: 'connected', title: status.name ?? 'Wheel base' };
  const seen = status.unknownBases[0];
  if (seen)
    return {
      state: 'seen',
      title: `RigReady sees ${seen.name}, but does not know this model`,
      seen,
    };
  if (status.awaitedName)
    return { state: 'awaited', title: `${status.awaitedName} is not connected` };
  if (status.lastSeen.length === 0 && status.software.every((s) => !s.ok))
    return { state: 'none', title: 'No wheel base RigReady knows is connected' };
  return {
    state: 'missing',
    title: status.brandName
      ? `No ${status.brandName} wheel base connected`
      : 'No wheel base connected',
  };
}
