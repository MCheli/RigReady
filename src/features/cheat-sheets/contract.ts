import { z } from 'zod';
import { ChangePreviewSchema } from '../../shared/changePreview';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { KneeboardOptionsSchema } from './core/kneeboardOptions';
import { DeviceLayoutSchema } from './core/layout';
import { SheetSchema } from './core/sheet';
import { trainerChannels } from './trainerContract';

const sheetRef = z.object({ game: z.string().min(1), aircraftId: z.string().min(1) });
const model = z.object({
  vendorId: z.string().regex(/^[0-9A-Fa-f]{4}$/),
  productId: z.string().regex(/^[0-9A-Fa-f]{4}$/),
});

export const OverviewSchema = z.object({
  games: z.array(
    z.object({
      game: z.string(),
      gameName: z.string(),
      /** Whether cheat sheets can become kneeboard pages in this game. */
      kneeboard: z.boolean(),
      aircraft: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          hasUserBindings: z.boolean(),
          general: z.boolean().optional(),
        })
      ),
    })
  ),
});
export type Overview = z.infer<typeof OverviewSchema>;

export const KneeboardStatusSchema = z.object({
  state: z.enum(['none', 'current', 'stale', 'missing']),
  summary: z.string(),
  /** Where the pages go (or went). Absent when the game's user folder is not found. */
  folder: z.string().optional(),
  exportedAt: z.string().optional(),
  pages: z.array(z.string()),
  options: KneeboardOptionsSchema.optional(),
  /** Why the pages cannot be written or removed right now: the game is running. */
  blocked: z.string().optional(),
});

/** The keys a kneeboard needs and where each is bound now (core/kneeboardKeys.ts). */
export const KneeboardKeysSchema = z.object({
  keys: z.array(
    z.object({
      key: z.enum(['show', 'next', 'previous']),
      /** The game's own name for the action. Absent when the aircraft has none. */
      action: z.string().optional(),
      /** "Button 12 on Throttle", "] on the keyboard"; empty when it is bound to nothing. */
      bound: z.array(z.string()),
      onController: z.boolean(),
    })
  ),
  /** Set when the pages cannot be turned from a controller: only from the keyboard, or from nothing. */
  pages: z.enum(['keyboard', 'unbound']).optional(),
  /** The in-app page where the keys can be bound, opened on this aircraft's kneeboard actions. */
  route: z.string(),
});
export type KneeboardKeysView = z.infer<typeof KneeboardKeysSchema>;

export const LiveDeviceSchema = z.object({
  guid: z.string(),
  pressed: z.array(z.string()),
  axes: z.record(z.string(), z.number()),
  moved: z.array(z.string()),
});

export const cheatSheetsContract = defineContract(
  'cheat-sheets',
  {
    /** The games whose bindings can be read, with their aircraft. */
    overview: channel(noInput, OverviewSchema, {
      describe:
        'The games whose bindings RigReady can read for cheat sheets, with their aircraft (or cars). game and aircraftId for the other cheat-sheets channels come from here. Changes nothing.',
      tier: 'read',
    }),
    /** The whole sheet of one aircraft: every device with its layout and labels. */
    sheet: channel(sheetRef, SheetSchema, {
      describe:
        "The whole cheat sheet of one aircraft: every controller with its drawing and the label of each bound control, plus the user's notes. game and aircraftId come from cheat-sheets:overview. Changes nothing.",
      tier: 'read',
    }),
    setNote: channel(
      sheetRef.extend({
        deviceKey: z.string().min(1),
        control: z.string().min(1),
        note: z.string().max(120),
      }),
      z.object({ saved: z.boolean() }),
      {
        describe:
          "Saves a short note on one control of a cheat sheet (an empty note takes it away). deviceKey and control come from cheat-sheets:sheet. Saved in RigReady's folder.",
        tier: 'change',
      }
    ),

    saveLayout: channel(
      model.extend({ layout: DeviceLayoutSchema }),
      z.object({ file: z.string() }),
      {
        describe:
          "Saves a controller drawing (layout) for one device model, by USB vendorId and productId, in RigReady's folder. It is used on every cheat sheet for that model.",
        tier: 'change',
      }
    ),
    resetLayout: channel(model, z.object({ removed: z.number() }), {
      describe:
        "Deletes the user's own drawing for a device model (vendorId and productId) so the built-in one is used again.",
      tier: 'change',
    }),
    /** Saves a layout as a file to share (asks where). */
    exportLayout: channel(
      z.object({ layout: DeviceLayoutSchema }),
      z.object({ path: z.string().nullable() }),
      { describe: 'Opens a save dialog to share a layout as a file.', tier: 'off' }
    ),
    /**
     * Asks for a layout file (a RigReady layout or drawing, or a Joystick Diagrams SVG
     * template) and returns it as a layout for this device model. Nothing is saved until the user saves.
     */
    importLayout: channel(
      model.extend({ name: z.string() }),
      z.object({
        layout: DeviceLayoutSchema.nullable(),
        from: z.enum(['rigready', 'rigready-drawing', 'joystick-diagrams']).optional(),
        /** Placeholders of a converted template that were not understood. */
        skipped: z.array(z.string()),
        file: z.string().optional(),
      }),
      {
        describe: 'Opens a file dialog to read a layout or Joystick Diagrams template.',
        tier: 'off',
      }
    ),
    /** Asks for a photo or drawing and returns it as a data URL for a layout's background. */
    pickBackground: channel(
      noInput,
      z.object({
        image: z.string().nullable(),
        width: z.number().optional(),
        height: z.number().optional(),
      }),
      { describe: 'Opens a file dialog to pick a background image for a layout.', tier: 'off' }
    ),

    savePdf: channel(
      sheetRef.extend({
        devices: z.array(z.string()),
        paper: z.enum(['A4', 'Letter']).default('A4'),
        summary: z.boolean().default(true),
      }),
      z.object({ path: z.string().nullable(), pages: z.number() }),
      { describe: 'Opens a save dialog and writes the cheat sheet as a PDF to print.', tier: 'off' }
    ),

    kneeboardStatus: channel(sheetRef, KneeboardStatusSchema, {
      describe:
        "Whether cheat sheet kneeboard pages for one aircraft are in DCS's Kneeboard folder and up to date. Changes nothing.",
      tier: 'read',
    }),
    /** One page as it would be exported, as a PNG data URL. */
    kneeboardPreview: channel(
      sheetRef.extend({
        deviceKey: z.string().optional(),
        style: z.enum(['light', 'night']),
      }),
      z.object({ image: z.string(), width: z.number(), height: z.number() }),
      {
        describe:
          'One kneeboard page of a cheat sheet as it would be exported, light or night, as a PNG image. deviceKey comes from cheat-sheets:sheet. Changes nothing.',
        tier: 'read',
      }
    ),
    /** What the export would write and remove in the kneeboard folder, before it does. */
    exportKneeboardPreview: channel(
      sheetRef.extend({ options: KneeboardOptionsSchema }),
      ChangePreviewSchema,
      {
        describe:
          "Shows what cheat-sheets:exportKneeboard would write and remove in the aircraft's DCS Kneeboard folder. Nothing is changed. Call it first and show the user.",
        tier: 'read',
      }
    ),
    removeKneeboardPreview: channel(sheetRef, ChangePreviewSchema, {
      describe:
        'Shows which kneeboard pages cheat-sheets:removeKneeboard would remove. Nothing is changed.',
      tier: 'read',
    }),
    exportKneeboard: channel(
      sheetRef.extend({ options: KneeboardOptionsSchema }),
      z.object({
        folder: z.string(),
        written: z.array(z.string()),
        removed: z.array(z.string()),
        kept: z.array(z.string()),
      }),
      {
        describe:
          'Writes the cheat sheet of one aircraft as kneeboard pages into its DCS Kneeboard folder, replacing pages RigReady wrote before. Call cheat-sheets:exportKneeboardPreview first and show the user.',
        tier: 'change',
      }
    ),
    removeKneeboard: channel(
      sheetRef,
      z.object({ removed: z.array(z.string()), kept: z.array(z.string()) }),
      {
        describe:
          'Removes the kneeboard pages RigReady wrote for one aircraft; other pages are kept. Call cheat-sheets:removeKneeboardPreview first and show the user.',
        tier: 'change',
      }
    ),

    /** Whether the kneeboard can be opened and its pages turned, and from where. */
    kneeboardKeys: channel(sheetRef, KneeboardKeysSchema, {
      describe:
        'What show or hide the kneeboard, next page and previous page are bound to for one aircraft, defaults included. pages says when the pages cannot be turned from a controller ("keyboard": only the keyboard turns them; "unbound": nothing does); tell the user then, and offer route, the page where they can be bound. Changes nothing.',
      tier: 'read',
    }),

    /** The setups the "kneeboard pages are up to date" check can go into, for one aircraft. */
    kneeboardSetups: channel(
      sheetRef,
      z.array(z.object({ id: z.string(), name: z.string(), checked: z.boolean() })),
      {
        describe:
          'The setups the kneeboard pages are up to date check can go into for one aircraft, and whether each has it. Changes nothing.',
        tier: 'read',
      }
    ),
    /** Adds the check (with the fix that writes the pages again) to a setup. */
    addKneeboardCheck: channel(
      sheetRef.extend({ profileId: z.string().min(1) }),
      z.object({ message: z.string() }),
      {
        describe:
          'Adds the kneeboard pages are up to date item, whose fix writes the pages again, to a setup. profileId comes from cheat-sheets:kneeboardSetups.',
        tier: 'change',
      }
    ),
    removeKneeboardCheck: channel(
      sheetRef.extend({ profileId: z.string().min(1) }),
      z.object({ message: z.string() }),
      {
        describe:
          'Takes the kneeboard pages item out of a setup. profileId comes from cheat-sheets:kneeboardSetups.',
        tier: 'change',
      }
    ),

    /**
     * Where a sheet opens when nothing was chosen yet: the game of the setup in use, else
     * the one most of the connected controllers are bound in. Null when no game has a sheet.
     */
    suggest: channel(noInput, z.object({ game: z.string(), aircraftId: z.string() }).nullable(), {
      describe:
        'Which cheat sheet to open when none was chosen: the game of the setup in use, else the one most connected controllers are bound in. Null when there is none. Changes nothing.',
      tier: 'read',
    }),

    /** Starts or stops live input for a window ("press a control, its label lights up"). */
    watch: channel(
      z.object({ client: z.string().min(1), on: z.boolean() }),
      z.object({ watching: z.boolean() }),
      { describe: 'Starts or stops live input events for a cheat sheet window.', tier: 'off' }
    ),
    /** Opens the quick-look sheet in a small window that stays on top. */
    popOut: channel(
      sheetRef.extend({ deviceKey: z.string().optional() }),
      z.object({ opened: z.boolean() }),
      { describe: 'Opens the quick-look cheat sheet in a small window.', tier: 'off' }
    ),
    /** "Learn your controls" (trainerContract.ts). */
    ...trainerChannels,
  },
  {
    /**
     * What the controllers say. `rest` marks what is said again for a window that began to
     * listen after another: where the controls are, not something that was just pressed.
     */
    input: z.object({ devices: z.array(LiveDeviceSchema), rest: z.boolean().optional() }),
    /** A game's bindings were changed by the feature that owns them: sheets of it are redrawn. */
    changed: z.object({ game: z.string(), aircraftId: z.string().optional() }),
  }
);
