import type { Rect } from './screens';

/**
 * Where each monitor's name goes on the screen map. A name sits at the top left of its monitor.
 * A viewport drawn there used to lie over it, so on a small monitor the two texts ran into each
 * other. The name now keeps to the room above the viewport, and where there is none the viewport
 * shows it above its own text.
 */

/** The room a name needs at the top of its monitor, in map pixels: two lines and the padding. */
export const NAME_ROOM = 30;
/** How far in from the left edge of its monitor a name reaches at most, in map pixels. */
const NAME_REACH = 150;
/** A viewport drawn smaller than this cannot hold a monitor's name as well as its own text. */
const HOLDS_A_NAME = { width: 56, height: 44 };
/** Below this height a viewport holding a monitor's name leaves out its own second line. */
const HOLDS_BOTH_LINES = 62;
/** From this height a viewport holding a monitor's name has room for the monitor's size too. */
const HOLDS_THE_SIZE = 96;
/** A viewport that starts this close to the corner of a monitor counts as starting on it. */
const AT_THE_CORNER = 2;

export type NamePlace =
  /** On the monitor. `room` is the height free above the first viewport; none when nothing is drawn there. */
  | { on: 'monitor'; room?: number }
  /** Inside the viewport that covers the corner where the name would be. */
  | { on: 'viewport'; key: string };

export interface CaptionPlan {
  monitors: Map<string, NamePlace>;
  /**
   * The viewports that show a monitor's name. `short`: their own second line no longer fits.
   * `withSize`: the monitor's size fits under its name.
   */
  viewports: Map<string, { monitor: string; short: boolean; withSize: boolean }>;
}

/**
 * @param scale Map pixels per desktop pixel. Zero before the map has been measured: every name
 *   then stays on its monitor.
 */
export function planCaptions(
  monitors: readonly (Rect & { id: string })[],
  viewports: readonly { key: string; rect: Rect }[],
  scale: number
): CaptionPlan {
  const plan: CaptionPlan = { monitors: new Map(), viewports: new Map() };
  for (const m of monitors) {
    if (!(scale > 0)) {
      plan.monitors.set(m.id, { on: 'monitor' });
      continue;
    }
    const reach = Math.min(m.width, NAME_REACH / scale);
    // The viewports drawn over the column the name is in, the highest first.
    const over = viewports
      .filter(
        (v) =>
          v.rect.x < m.x + reach &&
          v.rect.x + v.rect.width > m.x &&
          v.rect.y < m.y + m.height &&
          v.rect.y + v.rect.height > m.y
      )
      .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
    const first = over[0];
    if (!first) {
      plan.monitors.set(m.id, { on: 'monitor' });
      continue;
    }
    const room = Math.max(0, (first.rect.y - m.y) * scale);
    if (room >= NAME_ROOM) {
      plan.monitors.set(m.id, { on: 'monitor', room });
      continue;
    }
    const holder = over.find(
      (v) =>
        (v.rect.x - m.x) * scale >= -AT_THE_CORNER &&
        (v.rect.y - m.y) * scale >= -AT_THE_CORNER &&
        (v.rect.y - m.y) * scale < NAME_ROOM &&
        v.rect.width * scale >= HOLDS_A_NAME.width &&
        v.rect.height * scale >= HOLDS_A_NAME.height &&
        !plan.viewports.has(v.key)
    );
    if (!holder) {
      // A viewport too small to hold the name, or one that starts on another monitor.
      plan.monitors.set(m.id, { on: 'monitor' });
      continue;
    }
    plan.monitors.set(m.id, { on: 'viewport', key: holder.key });
    const height = holder.rect.height * scale;
    plan.viewports.set(holder.key, {
      monitor: m.id,
      short: height < HOLDS_BOTH_LINES,
      withSize: height >= HOLDS_THE_SIZE,
    });
  }
  return plan;
}
