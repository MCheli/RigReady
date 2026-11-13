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

/**
 * A line that is an example of a press and not one: what the preview on the Overlay page
 * shows while the overlay is off, marked as an example. Never among the presses.
 */
export const ExamplePressSchema = PressRowSchema.pick({
  control: true,
  device: true,
  actions: true,
  known: true,
});
export type ExamplePress = z.infer<typeof ExamplePressSchema>;

/** A setup whose monitor layout turns off the screen a part of the overlay was put on. */
export const OffInSchema = z.object({
  /** The setup's name. */
  setup: z.string(),
  /** The saved layout it uses, by name; absent when the setup keeps a layout of its own. */
  layout: z.string().optional(),
});
export type OffIn = z.infer<typeof OffInSchema>;

export const WidgetPlaceSchema = z.object({
  /** The screen it is shown on now (a monitor id); absent when no screen is on. */
  screen: z.string().optional(),
  screenName: z.string().optional(),
  at: AtSchema,
  /**
   * True: it goes on the main screen of the monitor layout in use, whichever monitor that
   * is. Absent: it was put on one monitor (`screen`, or `away` while that one is off).
   */
  main: z.literal(true).optional(),
  /** The screen the user put it on, when that one is not on and the main screen stands in. */
  away: z.string().optional(),
  /**
   * The setups with the overlay on whose monitor layout turns that screen off: while such a
   * layout is in use, the main screen stands in. Only for a part put on one monitor.
   */
  offIn: z.array(OffInSchema).optional(),
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
  /**
   * Lines for the preview on the page to judge the size and the number of lines by. Only
   * while the overlay is not up (off, or off in the setup in use), and only for the page: no
   * window of the overlay is up then.
   */
  examples: z.array(ExamplePressSchema).optional(),
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

/** A setup, and whether the overlay shows while it is the one in use. */
export const SetupOverlaySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The game it is for, by name, when it names one. */
  game: z.string().optional(),
  /** The overlay shows while this setup is the one in use. */
  on: z.boolean(),
  /** The user switched it in the setup. False: what the setup's game gives to begin with. */
  chosen: z.boolean(),
  /**
   * Why the overlay cannot say what a press does in this setup (what RigReady cannot read for
   * its game), which is also why it is off there to begin with. Absent: it can.
   */
  why: z.string().optional(),
});
export type SetupOverlay = z.infer<typeof SetupOverlaySchema>;

/** What a setup for a game starts with, for the switch in the setup editor. */
export const SetupDefaultSchema = z.object({
  /** On to begin with: RigReady can read the game's bindings, so a press is shown with what it does. */
  startsOn: z.boolean(),
  /** Why it cannot, when it cannot. */
  why: z.string().optional(),
  /** The overlay itself is turned on (the switch on the Overlay page). */
  overlayOn: z.boolean(),
});
export type SetupDefault = z.infer<typeof SetupDefaultSchema>;

export const OverlayStateSchema = z.object({
  /**
   * The user's switch on the Overlay page: the overlay is up whenever RigReady runs, while
   * the setup in use has it on (every setup has its own switch, `setups`).
   */
  on: z.boolean(),
  widgets: z.array(WidgetStateSchema),
  /** The screens that are on: where a widget can be put. */
  screens: z.array(OverlayScreenSchema),
  source: OverlaySourceSchema,
  /** Every setup, by name, and whether the overlay shows in it. */
  setups: z.array(SetupOverlaySchema),
  /**
   * The overlay is on and the setup in use has it off, so nothing is put over the game and
   * the controllers are not read for it until a setup that has it on is played.
   */
  offInSetup: z.object({ id: z.string(), name: z.string() }).optional(),
  /**
   * Whether the controllers are being read. Only while the overlay is up (on, and on in the
   * setup in use): that is when they are read for it.
   */
  input: z.object({ ok: z.boolean(), problem: z.string().optional() }).optional(),
  /** The settings file could not be read or written: nothing is changed until it can be. */
  problem: z.string().optional(),
});
export type OverlayState = z.infer<typeof OverlayStateSchema>;

/**
 * What is said when the overlay is on and the controllers are not being read: by the palette
 * and, in the same words, on the page. Why comes after it, in the reader's own words.
 */
export const NOT_READ = 'The overlay is on, but the controllers are not being read';
