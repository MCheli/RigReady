import { z } from 'zod';
import { err, ok, type Result } from '../../../core/result';
import type { At } from './settings';

/**
 * The widgets of the overlay. A widget is one thing drawn over the game, in a see-through
 * window of its own that the user places where it does not cover anything (each widget has
 * its own place, so they never have to share a corner).
 *
 * What a new widget takes:
 *
 * 1. A kind here, made with `defineWidget` and added to `WIDGET_KINDS`: its id, its words,
 *    where it sits until the user moves it, its options (a zod object in which every option
 *    has a default) and how big its window is for given options. The settings file, the
 *    place, "move it", the screens and the state the page reads then work for it as they are.
 * 2. Its drawing and the controls for its options: two components under `renderer/widgets/`,
 *    registered under the same id in `renderer/widgets/index.ts`. The overlay window and the
 *    preview on the page both mount the drawing.
 * 3. The live data it draws, when it needs any: an event in `contract.ts` that
 *    `core/service.ts` feeds (the recent presses get `presses`).
 */

export interface WidgetSize {
  /** In the units pages are laid out in (CSS pixels). */
  width: number;
  height: number;
}

/** What the service needs of a widget, whatever its options are. */
export interface WidgetKind {
  /** Also the last part of its window's address (/overlay/<id>) and its key in the settings. */
  id: string;
  title: string;
  /** One sentence for the page: what it shows. */
  summary: string;
  /** Where it sits on the main screen until the user places it. */
  defaultAt: At;
  /** The options in effect: the stored ones where they fit, its defaults where they do not. */
  options(stored: unknown): Record<string, unknown>;
  /** Options the user is setting: complete and valid, or what is wrong with them. */
  check(options: unknown): Result<Record<string, unknown>>;
  /** The size of its window for these options. */
  size(options: unknown): WidgetSize;
}

export interface Widget<S extends z.ZodObject> extends WidgetKind {
  schema: S;
  /** As `options`, typed: for the code that feeds this widget. */
  read(stored: unknown): z.output<S>;
}

export function defineWidget<S extends z.ZodObject>(widget: {
  id: string;
  title: string;
  summary: string;
  defaultAt: At;
  /** Every option has a default, so `{}` is a valid set of options. */
  schema: S;
  size(options: z.output<S>): WidgetSize;
}): Widget<S> {
  if (!/^[a-z][a-z0-9-]*$/.test(widget.id)) throw new Error(`Invalid widget id: ${widget.id}`);
  const defaults = widget.schema.parse({});
  const read = (stored: unknown): z.output<S> => {
    const parsed = widget.schema.safeParse(stored ?? {});
    return parsed.success ? parsed.data : defaults;
  };
  return {
    id: widget.id,
    title: widget.title,
    summary: widget.summary,
    defaultAt: widget.defaultAt,
    schema: widget.schema,
    read,
    options: (stored) => read(stored) as Record<string, unknown>,
    check: (options) => {
      const parsed = widget.schema.safeParse(options);
      if (!parsed.success) {
        return err(
          'overlay.options',
          `Those options do not fit "${widget.title}".`,
          z.prettifyError(parsed.error)
        );
      }
      return ok(parsed.data as Record<string, unknown>);
    },
    size: (options) => widget.size(read(options)),
  };
}

// ---- recent presses ----

export const RECENT_PRESSES = 'recent-presses';

export const RecentPressesOptionsSchema = z.object({
  /** How long a press stays, from the moment it was pressed until it has faded away. */
  lifetimeSeconds: z.number().min(1).max(30).default(5),
  /** The most presses shown at once; the oldest makes room for a new one. */
  rows: z.number().int().min(1).max(10).default(5),
  size: z.enum(['small', 'medium', 'large']).default('medium'),
  /** Whether a press that the game has nothing bound to is shown at all. */
  showUnbound: z.boolean().default(true),
});
export type RecentPressesOptions = z.infer<typeof RecentPressesOptionsSchema>;

/**
 * The measures of the list in CSS pixels, per size: the window is made exactly as big as the
 * most rows it may show, and the drawing uses the same numbers (renderer/widgets/RecentPresses.vue).
 */
export const RECENT_PRESSES_SIZES = {
  small: { width: 300, row: 42, text: 13, sub: 11 },
  medium: { width: 380, row: 52, text: 16, sub: 12 },
  large: { width: 500, row: 66, text: 21, sub: 14 },
} as const;
/** Between two rows, and between the rows and the edge of the window. */
export const RECENT_PRESSES_GAP = 6;
export const RECENT_PRESSES_PAD = 8;

export const recentPresses = defineWidget({
  id: RECENT_PRESSES,
  title: 'Recent presses',
  summary:
    'Each button or hat you press, with what it does in the game. The newest is always in the same spot; each fades away after a few seconds.',
  // Low in the middle: under the instruments of most cockpits, clear of the corners games use.
  defaultAt: { x: 0.5, y: 1 },
  schema: RecentPressesOptionsSchema,
  size: (options) => {
    const measure = RECENT_PRESSES_SIZES[options.size];
    return {
      width: measure.width + 2 * RECENT_PRESSES_PAD,
      height:
        2 * RECENT_PRESSES_PAD +
        options.rows * measure.row +
        (options.rows - 1) * RECENT_PRESSES_GAP,
    };
  },
});

/** Every widget there is, in the order the page shows them. */
export const WIDGET_KINDS: readonly WidgetKind[] = [recentPresses];

export const widgetKind = (id: string): WidgetKind | undefined =>
  WIDGET_KINDS.find((kind) => kind.id === id);
