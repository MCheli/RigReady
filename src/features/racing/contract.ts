import { z } from 'zod';
import { ChangePreviewSchema } from '../../shared/changePreview';
import { channel, defineContract, noInput } from '../../shared/ipc';

const Pair = z.object({ label: z.string(), value: z.string() });

// ---------------------------------------------------------------- iRacing

export const IracingDeviceViewSchema = z.object({
  /** The instance GUID iRacing stored (upper case, no braces). */
  key: z.string(),
  name: z.string(),
  /** The name the owner gave the device on the Devices page, shown before `name`. */
  givenName: z.string().optional(),
  instanceGuid: z.string(),
  productGuid: z.string(),
  vendorId: z.string().optional(),
  productId: z.string().optional(),
  /**
   * connected: the stored id is a controller attached now. moved: a controller of the same
   * model is attached under a new id (iRacing will ask to recalibrate). missing: no such
   * controller is attached. unknown: the controllers could not be read.
   */
  state: z.enum(['connected', 'moved', 'missing', 'unknown']),
  calibrated: z.boolean(),
  axes: z.array(z.object({ axis: z.number(), name: z.string(), range: z.string() })),
  bindingCount: z.number(),
  /** For "moved": the attached controllers it could now be. */
  candidates: z.array(z.object({ guid: z.string(), label: z.string() })),
  /** The one candidate RigReady is sure of, when there is exactly one. */
  suggested: z.string().optional(),
});
export type IracingDeviceView = z.infer<typeof IracingDeviceViewSchema>;

export const IracingViewSchema = z.object({
  installed: z.boolean(),
  running: z.boolean(),
  simRunning: z.boolean(),
  userFolder: z.string().optional(),
  controlsFound: z.boolean(),
  calibrationFound: z.boolean(),
  problems: z.array(z.string()),
  devices: z.array(IracingDeviceViewSchema),
  bindings: z.array(
    z.object({
      action: z.string(),
      label: z.string(),
      group: z.string(),
      device: z.string().optional(),
      deviceName: z.string(),
      input: z.string(),
    })
  ),
  unboundCount: z.number(),
  customCars: z.array(z.string()),
  forceFeedback: z.array(z.object({ key: z.string(), value: z.string(), note: z.string() })),
});
export type IracingView = z.infer<typeof IracingViewSchema>;

// ---------------------------------------------------------------- Le Mans Ultimate

export const LmuDeviceViewSchema = z.object({
  key: z.string(),
  name: z.string(),
  /** The name the owner gave the device on the Devices page, shown before `name`. */
  givenName: z.string().optional(),
  vendorId: z.string().optional(),
  productId: z.string().optional(),
  type: z.string(),
  /** other-mode: a Fanatec base is attached, but in compatibility (yellow) mode. */
  state: z.enum(['connected', 'missing', 'other-mode', 'unknown']),
  forceFeedback: z.array(Pair),
  options: z.array(Pair),
  bindingCount: z.number(),
});
export type LmuDeviceView = z.infer<typeof LmuDeviceViewSchema>;

export const LmuViewSchema = z.object({
  installed: z.boolean(),
  running: z.boolean(),
  updatePending: z.boolean(),
  userFolder: z.string().optional(),
  problems: z.array(z.string()),
  devices: z.array(LmuDeviceViewSchema),
  bindings: z.array(
    z.object({
      action: z.string(),
      slot: z.enum(['primary', 'alternative']),
      device: z.string(),
      deviceName: z.string(),
      input: z.string(),
    })
  ),
  steering: z.array(Pair),
});
export type LmuView = z.infer<typeof LmuViewSchema>;

// ---------------------------------------------------------------- BeamNG.drive

export const BeamngMapViewSchema = z.object({
  /** Relative to settings\inputmaps, forward slashes: "00070eb7.diff", "pickup/00070eb7.diff". */
  file: z.string(),
  /** Set for per-vehicle maps. */
  vehicle: z.string().optional(),
  name: z.string(),
  /** The name the owner gave the device on the Devices page, shown before `name`. */
  givenName: z.string().optional(),
  vidpid: z.string(),
  vendorId: z.string().optional(),
  productId: z.string().optional(),
  state: z.enum(['connected', 'missing', 'other-mode', 'keyboard', 'unknown']),
  /** True when the game's default map was read too, so the list is complete. */
  factoryLoaded: z.boolean(),
  bindings: z.array(
    z.object({
      action: z.string(),
      label: z.string(),
      input: z.string(),
      detail: z.string(),
      yours: z.boolean(),
    })
  ),
  removed: z.array(z.object({ action: z.string(), label: z.string(), input: z.string() })),
  forceFeedback: z.array(Pair),
  /** For a controller that is not attached: attached controllers its bindings can be given to. */
  targets: z.array(z.object({ vidpid: z.string(), name: z.string() })),
});
export type BeamngMapView = z.infer<typeof BeamngMapViewSchema>;

export const BeamngViewSchema = z.object({
  installed: z.boolean(),
  running: z.boolean(),
  userFolder: z.string().optional(),
  problems: z.array(z.string()),
  maps: z.array(BeamngMapViewSchema),
  older: z.array(z.object({ version: z.string(), path: z.string(), bindingFiles: z.number() })),
});
export type BeamngView = z.infer<typeof BeamngViewSchema>;

// ---------------------------------------------------------------- Assetto Corsa

export const AcViewSchema = z.object({
  installed: z.boolean(),
  running: z.boolean(),
  controlsFile: z.string().optional(),
  inputMethod: z.string().optional(),
  problems: z.array(z.string()),
  controllers: z.array(
    z.object({
      index: z.number(),
      name: z.string(),
      instanceGuid: z.string(),
      productGuid: z.string(),
      vendorId: z.string().optional(),
      productId: z.string().optional(),
      state: z.enum(['connected', 'moved', 'missing', 'unknown']),
      /** At least one binding uses it. */
      used: z.boolean(),
    })
  ),
  bindings: z.array(
    z.object({ action: z.string(), label: z.string(), controller: z.string(), input: z.string() })
  ),
  forceFeedback: z.array(Pair),
});
export type AcView = z.infer<typeof AcViewSchema>;

// ---------------------------------------------------------------- Wheel (Fanatec)

export const WheelStatusSchema = z.object({
  connected: z.boolean(),
  name: z.string().optional(),
  /** The name the owner gave the device on the Devices page, shown before `name`. */
  givenName: z.string().optional(),
  vendorId: z.string().optional(),
  productId: z.string().optional(),
  /** pc: native (red) mode. compatibility: yellow mode, reporting as a ClubSport V2.5. */
  mode: z.enum(['pc', 'compatibility', 'none']),
  /** DirectInput controllers games see for the base. */
  controllers: z.number(),
  connection: z.string().optional(),
  accessories: z.array(z.string()),
  software: z.array(z.object({ label: z.string(), value: z.string(), ok: z.boolean() })),
  firmwareShipped: z.string().optional(),
  lastSeen: z.array(Pair),
});
export type WheelStatus = z.infer<typeof WheelStatusSchema>;

export const PRESET_PARAMS = [
  'SEN',
  'FF',
  'FFS',
  'NDP',
  'NFR',
  'NIN',
  'INT',
  'FEI',
  'FOR',
  'SPR',
  'DPR',
  'BLI',
  'SHO',
  'BRF',
] as const;

export const WheelPresetSchema = z.object({
  slot: z.number().int().min(1).max(5),
  name: z.string().max(40).default(''),
  /** Values as the base shows them: "1080", "AUT", "Lin", "Off". */
  values: z.record(z.string(), z.string().max(12)).default({}),
  note: z.string().max(200).default(''),
});
export const WheelPresetsSchema = z.object({
  presets: z.array(WheelPresetSchema).length(5),
  /** The preset you normally drive with; its values fill the comparison. */
  activeSlot: z.number().int().min(1).max(5).default(1),
  updatedAt: z.string().optional(),
});
export type WheelPresets = z.infer<typeof WheelPresetsSchema>;

export const GameComparisonSchema = z.object({
  game: z.string(),
  name: z.string(),
  installed: z.boolean(),
  source: z.object({ title: z.string(), url: z.string(), official: z.boolean() }),
  also: z.array(z.object({ title: z.string(), url: z.string() })),
  retrieved: z.string(),
  caveat: z.string().optional(),
  rows: z.array(
    z.object({
      where: z.enum(['base', 'game']),
      label: z.string(),
      recommended: z.string(),
      current: z.string(),
      /** unreadable: set on the wheel or not in a file. info: read, nothing to compare with. */
      status: z.enum(['match', 'differs', 'unreadable', 'info']),
      note: z.string().optional(),
    })
  ),
});
export type GameComparison = z.infer<typeof GameComparisonSchema>;

export const WheelViewSchema = z.object({
  status: WheelStatusSchema,
  presets: WheelPresetsSchema,
  parameters: z.array(z.object({ id: z.string(), name: z.string(), meaning: z.string() })),
  comparisons: z.array(GameComparisonSchema),
});
export type WheelView = z.infer<typeof WheelViewSchema>;

// ---------------------------------------------------------------- Overview

export const RacingOverviewSchema = z.object({
  wheel: WheelStatusSchema,
  apps: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      purpose: z.string(),
      installed: z.boolean(),
      running: z.boolean(),
    })
  ),
  games: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      installed: z.boolean(),
      running: z.boolean(),
      version: z.string().optional(),
      updatePending: z.boolean(),
      /** One line: the state of its bindings. */
      bindings: z.string(),
      attention: z.boolean(),
    })
  ),
});
export type RacingOverview = z.infer<typeof RacingOverviewSchema>;

// ---------------------------------------------------------------- Backups

export const BACKUP_GAMES = ['iracing', 'lmu', 'beamng', 'assetto-corsa', 'fanatec'] as const;
export const BackupGameSchema = z.enum(BACKUP_GAMES);
export type BackupGame = z.infer<typeof BackupGameSchema>;

export const BindingBackupSchema = z.object({
  id: z.string(),
  game: BackupGameSchema,
  createdAt: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      stored: z.string(),
      label: z.string(),
      restorable: z.boolean(),
      size: z.number(),
    })
  ),
});
export type BindingBackup = z.infer<typeof BindingBackupSchema>;

const Message = z.object({ message: z.string() });
/** What a restore or copy will do to each file, shown before anything is written. */
export const WritePreviewSchema = ChangePreviewSchema;
export type WritePreviewView = z.infer<typeof WritePreviewSchema>;

const GameRef = z.object({ game: BackupGameSchema });
const BackupRef = z.object({ game: BackupGameSchema, id: z.string().regex(/^[\w-]+$/) });

export const racingContract = defineContract('racing', {
  overview: channel(noInput, RacingOverviewSchema),
  iracing: channel(noInput, IracingViewSchema),
  /** Points iRacing at controllers' new Windows ids (old instance GUID -> new). */
  iracingRepair: channel(
    z.object({ mapping: z.array(z.object({ from: z.string(), to: z.string() })).min(1) }),
    Message
  ),
  /** Which iRacing files that repair would change and how. Reads only. */
  iracingRepairPreview: channel(
    z.object({ mapping: z.array(z.object({ from: z.string(), to: z.string() })).min(1) }),
    WritePreviewSchema
  ),
  lmu: channel(noInput, LmuViewSchema),
  beamng: channel(noInput, BeamngViewSchema),
  beamngCopyOlder: channel(z.object({ version: z.string().regex(/^[\d.]+$/) }), Message),
  /** Which binding files that copy would create and replace. Reads only. */
  beamngCopyOlderPreview: channel(
    z.object({ version: z.string().regex(/^[\d.]+$/) }),
    WritePreviewSchema
  ),
  beamngCopyToController: channel(
    z.object({
      file: z.string().regex(/^[\w ./-]+\.diff$/),
      to: z.string().regex(/^[0-9a-f]{8}$/i),
    }),
    Message
  ),
  /** The binding file that copy would create. Reads only. */
  beamngCopyToControllerPreview: channel(
    z.object({
      file: z.string().regex(/^[\w ./-]+\.diff$/),
      to: z.string().regex(/^[0-9a-f]{8}$/i),
    }),
    WritePreviewSchema
  ),
  assettoCorsa: channel(noInput, AcViewSchema),
  wheel: channel(noInput, WheelViewSchema),
  savePresets: channel(WheelPresetsSchema, WheelPresetsSchema),
  backups: channel(GameRef, z.array(BindingBackupSchema)),
  backup: channel(GameRef, BindingBackupSchema),
  restore: channel(BackupRef.extend({ closeApp: z.boolean().default(false) }), Message),
  /** What restoring that backup would change, file by file. Reads only. */
  restorePreview: channel(BackupRef, WritePreviewSchema),
  deleteBackup: channel(BackupRef, z.object({ deleted: z.boolean() })),
});
