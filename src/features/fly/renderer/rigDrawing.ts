/**
 * The desktop drawn to scale: every monitor that is on, at its place and size, inside a
 * box of a given size. Pure, so the drawing is tested without a browser.
 */

export interface DrawnMonitor {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: boolean;
}

export interface MonitorBox<T> {
  monitor: T;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DeskDrawing<T> {
  /** Size of the whole drawing in pixels. */
  width: number;
  height: number;
  /** Pixels per desktop pixel: the same in both directions. */
  scale: number;
  boxes: MonitorBox<T>[];
}

const round = (n: number): number => Math.round(n * 10) / 10;

/**
 * Fits the monitors that are on into `maxWidth` x `maxHeight`, keeping their proportions.
 * Undefined when no monitor is on.
 */
export function drawDesk<T extends DrawnMonitor>(
  monitors: T[],
  maxWidth: number,
  maxHeight: number
): DeskDrawing<T> | undefined {
  const on = monitors.filter((m) => m.enabled && m.width > 0 && m.height > 0);
  if (on.length === 0) return undefined;
  const left = Math.min(...on.map((m) => m.x));
  const top = Math.min(...on.map((m) => m.y));
  const width = Math.max(...on.map((m) => m.x + m.width)) - left;
  const height = Math.max(...on.map((m) => m.y + m.height)) - top;
  const scale = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: round(width * scale),
    height: round(height * scale),
    scale,
    boxes: on.map((monitor) => ({
      monitor,
      left: round((monitor.x - left) * scale),
      top: round((monitor.y - top) * scale),
      width: round(monitor.width * scale),
      height: round(monitor.height * scale),
    })),
  };
}
