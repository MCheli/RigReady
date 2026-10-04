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
});

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
    overview: channel(noInput, OverviewSchema),
    /** The whole sheet of one aircraft: every device with its layout and labels. */
    sheet: channel(sheetRef, SheetSchema),
    setNote: channel(
      sheetRef.extend({
        deviceKey: z.string().min(1),
        control: z.string().min(1),
        note: z.string().max(120),
      }),
      z.object({ saved: z.boolean() })
    ),

    saveLayout: channel(
      model.extend({ layout: DeviceLayoutSchema }),
      z.object({ file: z.string() })
    ),
    resetLayout: channel(model, z.object({ removed: z.number() })),
    /** Saves a layout as a file to share (asks where). */
    exportLayout: channel(
      z.object({ layout: DeviceLayoutSchema }),
      z.object({ path: z.string().nullable() })
    ),
    /**
     * Asks for a layout file (a RigReady layout or a Joystick Diagrams SVG template) and
     * returns it as a layout for this device model. Nothing is saved until the user saves.
     */
    importLayout: channel(
      model.extend({ name: z.string() }),
      z.object({
        layout: DeviceLayoutSchema.nullable(),
        from: z.enum(['rigready', 'joystick-diagrams']).optional(),
        /** Placeholders of a converted template that were not understood. */
        skipped: z.array(z.string()),
        file: z.string().optional(),
      })
    ),
    /** Asks for a photo or drawing and returns it as a data URL for a layout's background. */
    pickBackground: channel(
      noInput,
      z.object({
        image: z.string().nullable(),
        width: z.number().optional(),
        height: z.number().optional(),
      })
    ),

    savePdf: channel(
      sheetRef.extend({
        devices: z.array(z.string()),
        paper: z.enum(['A4', 'Letter']).default('A4'),
        summary: z.boolean().default(true),
      }),
      z.object({ path: z.string().nullable(), pages: z.number() })
    ),

    kneeboardStatus: channel(sheetRef, KneeboardStatusSchema),
    /** One page as it would be exported, as a PNG data URL. */
    kneeboardPreview: channel(
      sheetRef.extend({
        deviceKey: z.string().optional(),
        style: z.enum(['light', 'night']),
      }),
      z.object({ image: z.string(), width: z.number(), height: z.number() })
    ),
    /** What the export would write and remove in the kneeboard folder, before it does. */
    exportKneeboardPreview: channel(
      sheetRef.extend({ options: KneeboardOptionsSchema }),
      ChangePreviewSchema
    ),
    removeKneeboardPreview: channel(sheetRef, ChangePreviewSchema),
    exportKneeboard: channel(
      sheetRef.extend({ options: KneeboardOptionsSchema }),
      z.object({
        folder: z.string(),
        written: z.array(z.string()),
        removed: z.array(z.string()),
        kept: z.array(z.string()),
      })
    ),
    removeKneeboard: channel(
      sheetRef,
      z.object({ removed: z.array(z.string()), kept: z.array(z.string()) })
    ),

    /** The setups the "kneeboard pages are up to date" check can go into, for one aircraft. */
    kneeboardSetups: channel(
      sheetRef,
      z.array(z.object({ id: z.string(), name: z.string(), checked: z.boolean() }))
    ),
    /** Adds the check (with the fix that writes the pages again) to a setup. */
    addKneeboardCheck: channel(
      sheetRef.extend({ profileId: z.string().min(1) }),
      z.object({ message: z.string() })
    ),
    removeKneeboardCheck: channel(
      sheetRef.extend({ profileId: z.string().min(1) }),
      z.object({ message: z.string() })
    ),

    /**
     * Where a sheet opens when nothing was chosen yet: the game of the setup in use, else
     * the one most of the connected controllers are bound in. Null when no game has a sheet.
     */
    suggest: channel(noInput, z.object({ game: z.string(), aircraftId: z.string() }).nullable()),

    /** Starts or stops live input for a window ("press a control, its label lights up"). */
    watch: channel(
      z.object({ client: z.string().min(1), on: z.boolean() }),
      z.object({ watching: z.boolean() })
    ),
    /** Opens the quick-look sheet in a small window that stays on top. */
    popOut: channel(
      sheetRef.extend({ deviceKey: z.string().optional() }),
      z.object({ opened: z.boolean() })
    ),
    /** "Learn your controls" (trainerContract.ts). */
    ...trainerChannels,
  },
  {
    input: z.object({ devices: z.array(LiveDeviceSchema) }),
    /** A game's bindings were changed by the feature that owns them: sheets of it are redrawn. */
    changed: z.object({ game: z.string(), aircraftId: z.string().optional() }),
  }
);
