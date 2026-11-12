import { z } from 'zod';
import { AtSchema } from './settings';

/**
 * What the overlay tells its windows and its page: the shapes `contract.ts` sends. Schemas
 * only, so the pages can use the types.
 */

export const PressActionSchema = z.object({
  /** The action, as the game names it. */
  action: z.string(),
  /** What must be held with the control for it, when anything. */
  modifiers: z.array(z.string()),
});
export type PressAction = z.infer<typeof PressActionSchema>;

/** One line of the recent presses. */
export const PressRowSchema = z.object({
  /** The same while the line is the same control, also through the positions of a switch. */
  id: z.number().int(),
  /** How many times running it was pressed. */
  count: z.number().int().min(1),
  /** When it was last pressed, by the clock of the main side (milliseconds). */
  stamp: z.number(),
  /**
   * How long ago that was when this was sent. A window counts on from here by its own
   * clock, so the fading is right whatever the two clocks say.
   */
  ageMs: z.number().min(0),
  /** "Button 12", "Hat 1 up". */
  control: z.string(),
  /** The controller, short: the name the user gave it where there is one. */
  device: z.string(),
  /** What the game does on it for the aircraft in use: what works on its own first. */
  actions: z.array(PressActionSchema),
  /**
   * False when the game's bindings could not be read: no actions then means "not known",
   * and only with true does it mean that nothing is bound.
   */
  known: z.boolean(),
});
export type PressRow = z.infer<typeof PressRowSchema>;

export const PressRowsSchema = z.object({ rows: z.array(PressRowSchema) });

export const WidgetPlaceSchema = z.object({
  /** The screen it is shown on now (a monitor id); absent when no screen is on. */
  screen: z.string().optional(),
  screenName: z.string().optional(),
  at: AtSchema,
  /** The screen the user put it on, when that one is not on and the main screen stands in. */
  away: z.string().optional(),
});

export const WidgetStateSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  /** The options in effect: the user's, or the widget's defaults. */
  options: z.record(z.string(), z.unknown()),
  /** The size of its window for these options, in CSS pixels. */
  width: z.number(),
  height: z.number(),
  place: WidgetPlaceSchema,
  /** Its window is up over whatever is on that screen. */
  showing: z.boolean(),
  /** The user is placing it: the window takes the mouse and can be dragged. */
  moving: z.boolean(),
  /** Why it is not showing although the overlay is on. */
  problem: z.string().optional(),
});
export type WidgetState = z.infer<typeof WidgetStateSchema>;

export const OverlayScreenSchema = z.object({
  id: z.string(),
  name: z.string(),
  primary: z.boolean(),
  width: z.number(),
  height: z.number(),
});

export const PickedHowSchema = z.enum(['chosen', 'setup', 'only', 'guess']);

/** Where the words for a press come from. */
export const OverlaySourceSchema = z.object({
  /** The setup in use: the last one played, or the first. */
  setup: z.object({ id: z.string(), name: z.string() }).optional(),
  /** The game whose bindings are read. */
  game: z.object({ id: z.string(), name: z.string() }).optional(),
  /** The aircraft or car the labels are for, and how RigReady came to it. */
  aircraft: z.object({ id: z.string(), name: z.string(), how: PickedHowSchema }).optional(),
  /** What the game has bindings for: what the user can choose from. */
  choices: z.array(z.object({ id: z.string(), name: z.string(), hasUserBindings: z.boolean() })),
  /** Why presses are shown without what they do, when that is so. */
  problem: z.string().optional(),
});
export type OverlaySource = z.infer<typeof OverlaySourceSchema>;

export const OverlayStateSchema = z.object({
  /** The user's switch: the overlay is up whenever RigReady runs. */
  on: z.boolean(),
  widgets: z.array(WidgetStateSchema),
  /** The screens that are on: where a widget can be put. */
  screens: z.array(OverlayScreenSchema),
  source: OverlaySourceSchema,
  /**
   * Whether the controllers are being read. Only while the overlay is on: that is when they
   * are read for it.
   */
  input: z.object({ ok: z.boolean(), problem: z.string().optional() }).optional(),
  /** The settings file could not be read or written: nothing is changed until it can be. */
  problem: z.string().optional(),
});
export type OverlayState = z.infer<typeof OverlayStateSchema>;
