import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/**
 * What the tester's canvases share: one animation frame loop for all of them, the colours of
 * the design system, crisp sizing on any display scale, and whether the user asked Windows
 * for less motion.
 */

/** Draws when it has something new to show; answers true to be called again next frame. */
export type Painter = (now: number) => boolean;

const painters = new Set<Painter>();
let handle: number | undefined;

function run(now: number): void {
  handle = undefined;
  let again = false;
  for (const paint of painters) if (paint(now)) again = true;
  if (again) schedule();
}

/** Asks for one frame in which every painter gets its turn. Cheap to call often. */
export function schedule(): void {
  if (painters.size > 0) handle ??= requestAnimationFrame(run);
}

/** Painters run in the order they were added. Returns the function that removes this one. */
export function addPainter(painter: Painter): () => void {
  painters.add(painter);
  schedule();
  return () => {
    painters.delete(painter);
  };
}

export interface Palette {
  bg: string;
  surface: string;
  raised: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
}

let palette: Palette | undefined;

/** The design tokens of src/renderer/styles.css, as a canvas needs them. */
export function themePalette(): Palette {
  if (palette) return palette;
  const style = getComputedStyle(document.documentElement);
  const token = (name: string): string => style.getPropertyValue(name).trim();
  palette = {
    bg: token('--rr-bg'),
    surface: token('--rr-surface'),
    raised: token('--rr-surface-2'),
    border: token('--rr-border'),
    text: token('--rr-text'),
    muted: token('--rr-muted'),
    accent: token('--rr-accent'),
  };
  return palette;
}

/** A token colour (#rrggbb) at an opacity. */
export function alpha(hex: string, opacity: number): string {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1];
  if (!value) return hex;
  const part = (at: number): number => parseInt(value.slice(at, at + 2), 16);
  return `rgba(${part(0)}, ${part(2)}, ${part(4)}, ${opacity})`;
}

export interface Surface {
  ctx: CanvasRenderingContext2D;
  /** Size in CSS pixels; the context is already scaled to the display. */
  width: number;
  height: number;
}

/**
 * Makes the canvas's bitmap match its size on screen (times the display scale, so lines
 * stay sharp) and hands back a context that draws in CSS pixels. Undefined while the canvas
 * has no size yet.
 */
export function surfaceOf(canvas: HTMLCanvasElement): Surface | undefined {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return undefined;
  const scale = Math.max(1, window.devicePixelRatio || 1);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

/** A rounded box: the dark inset every instrument of the tester is drawn in. */
export function inset(surface: Surface, radius = 4): void {
  const { ctx, width, height } = surface;
  const colours = themePalette();
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, width - 1, height - 1, radius);
  ctx.fillStyle = colours.bg;
  ctx.fill();
  ctx.strokeStyle = colours.border;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * True while Windows is set to show less animation ("Animation effects" off). The tester
 * then shows where everything is now, and no trails.
 */
export function useReducedMotion(): Ref<boolean> {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = ref(query.matches);
  const update = (): void => {
    reduced.value = query.matches;
  };
  onMounted(() => query.addEventListener('change', update));
  onBeforeUnmount(() => query.removeEventListener('change', update));
  return reduced;
}

/**
 * Keeps one canvas painted: adds its painter to the shared loop while the component is
 * there, and asks for a frame whenever the canvas changes size.
 */
export function usePainter(canvas: Ref<HTMLCanvasElement | undefined>, painter: Painter): void {
  let remove: (() => void) | undefined;
  let observer: ResizeObserver | undefined;
  onMounted(() => {
    remove = addPainter(painter);
    if (canvas.value) {
      observer = new ResizeObserver(() => schedule());
      observer.observe(canvas.value);
    }
  });
  onBeforeUnmount(() => {
    remove?.();
    observer?.disconnect();
  });
}
