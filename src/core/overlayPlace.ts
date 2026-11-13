/**
 * Where an overlay panel sits on a screen (`ports.overlays.showPanel`). A place is kept as
 * a share of the room the panel leaves free on its screen, from the left and from the top:
 * (0, 0) is the top left corner, (1, 1) the bottom right, (0.5, 0.5) the middle. Kept that
 * way, a place means the same on a screen of another size, at another scaling, or after
 * the monitor layout changed. Pure: the platform supplies the screens and moves the window.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A share of the free room: 0..1 from the left and from the top. */
export interface OverlayAt {
  x: number;
  y: number;
}

const share = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;

/**
 * Five decimals: finer than a pixel on any screen, so a panel that is read and put back
 * (dragged, then locked) stays on the pixel it was on. Three were not enough on a screen
 * five thousand pixels wide.
 */
const tidy = (value: number): number => Math.round(share(value) * 100_000) / 100_000;

/**
 * The box of a panel of this size at this place on a screen. A panel larger than the
 * screen is made as small as the screen, so no part of it is ever off it.
 */
export function panelBox(screen: Box, size: { width: number; height: number }, at: OverlayAt): Box {
  const width = Math.max(1, Math.min(Math.round(size.width), screen.width));
  const height = Math.max(1, Math.min(Math.round(size.height), screen.height));
  return {
    x: Math.round(screen.x + (screen.width - width) * share(at.x)),
    y: Math.round(screen.y + (screen.height - height) * share(at.y)),
    width,
    height,
  };
}

/**
 * The place a box is at on a screen: the inverse of `panelBox`. A box hanging over an edge
 * counts as being at that edge; one that fills the screen in a direction is in the middle
 * of it.
 */
export function panelAt(screen: Box, box: Box): OverlayAt {
  const roomX = screen.width - box.width;
  const roomY = screen.height - box.height;
  return {
    x: roomX <= 0 ? 0.5 : tidy((box.x - screen.x) / roomX),
    y: roomY <= 0 ? 0.5 : tidy((box.y - screen.y) / roomY),
  };
}

const overlap = (a: Box, b: Box): number => {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
};

/**
 * The screen a box is on: the one its middle is inside, else the one it covers most of.
 * Undefined when it touches none of them.
 */
export function screenOf<T extends Box>(screens: readonly T[], box: Box): T | undefined {
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const holds = screens.find(
    (s) =>
      middle.x >= s.x && middle.x < s.x + s.width && middle.y >= s.y && middle.y < s.y + s.height
  );
  if (holds) return holds;
  let best: T | undefined;
  let most = 0;
  for (const screen of screens) {
    const shared = overlap(screen, box);
    if (shared > most) {
      most = shared;
      best = screen;
    }
  }
  return best;
}
