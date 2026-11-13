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
  /**
   * other-mode: a Fanatec base is attached, but in compatibility (yellow) mode. renamed: the
   * controller is attached, but Windows now gives it another name than the game stored.
   */
  state: z.enum(['connected', 'renamed', 'missing', 'other-mode', 'unknown']),
  forceFeedback: z.array(Pair),
  options: z.array(Pair),
  bindingCount: z.number(),
  /**
   * For "renamed", and only when RigReady can repair it: the name the controller has now.
   * `exact`: the game already lists it under that name, so the id written is the game's own.
   */
  rename: z.object({ name: z.string(), exact: z.boolean(), bindings: z.number() }).optional(),
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
      /** The game's own name for the input: "button11", "xaxis", "upov". */
      control: z.string(),
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
  /** Whether the order in which Windows lists the controllers is known (it decides JOY=n). */
  orderKnown: z.boolean(),
  /** A controller that bindings use is at another number or has a new Windows id. */
  repairNeeded: z.boolean(),
  problems: z.array(z.string()),
  controllers: z.array(
    z.object({
      /** Its number in controls.ini (CONn; the bindings say JOY=n). */
      index: z.number(),
      name: z.string(),
      /** The name the owner gave the device on the Devices page, shown before `name`. */
      givenName: z.string().optional(),
      /** Empty when the file has none (Content Manager writes it, the game alone does not). */
      instanceGuid: z.string(),
      productGuid: z.string(),
      vendorId: z.string().optional(),
      productId: z.string().optional(),
      /**
       * connected: attached at its number. reordered: attached, at another number now.
       * moved: a controller of the same model is attached under a new Windows id. missing:
       * nothing of that model is attached. unknown: the controllers could not be read.
       */
      state: z.enum(['connected', 'reordered', 'moved', 'missing', 'unknown']),
      /** At least one binding uses it. */
      used: z.boolean(),
      bindingCount: z.number(),
      /** The connected controller RigReady is sure it is now, and its number in Windows' order. */
      now: z
        .object({ guid: z.string(), name: z.string(), number: z.number().optional() })
        .optional(),
      /** When RigReady is not sure: the connected controllers of that model it could be. */
      candidates: z.array(z.object({ guid: z.string(), label: z.string() })),
    })
  ),
  bindings: z.array(
    z.object({
      action: z.string(),
      label: z.string(),
      controller: z.string(),
      input: z.string(),
      /** JOY=n of the binding; absent for a key. */
      number: z.number().optional(),
      /** The controller at that number in Windows' order now: what the game will really use. */
      actsOn: z.string().optional(),
    })
  ),
  forceFeedback: z.array(Pair),
});
export type AcView = z.infer<typeof AcViewSchema>;

// ---------------------------------------------------------------- Wheel (every brand)

export const WHEEL_BRANDS = [
  'fanatec',
  'moza',
  'logitech',
  'simagic',
  'thrustmaster',
  'simucube',
  'asetek',
  'cammus',
] as const;
export const WheelBrandSchema = z.enum(WHEEL_BRANDS);
export type WheelBrandId = z.infer<typeof WheelBrandSchema>;

export const WheelPartSchema = z.object({
  role: z.enum(['base', 'rim', 'pedals', 'shifter', 'handbrake', 'other']),
  name: z.string(),
  vendorId: z.string(),
  productId: z.string(),
});
export type WheelPart = z.infer<typeof WheelPartSchema>;

/** A four-digit USB id in hex ("0EB7"). */
const UsbId = z.string().regex(/^[0-9A-Fa-f]{4}$/);

/**
 * A connected controller that is not in RigReady's table of wheel parts
 * (core/wheelbases/products.ts) and that the user has not said is their wheel base.
 */
export const UnlistedControllerSchema = z.object({
  vendorId: z.string(),
  productId: z.string(),
  name: z.string(),
  /** DirectInput controllers games see for it. */
  controllers: z.number().int(),
  /** Axes and buttons of its first controller; 0 when games do not see it. */
  axes: z.number().int(),
  buttons: z.number().int(),
  /** Its name, or its maker's USB id with its axes and buttons, says it may be a wheel base. */
  looksLikeWheel: z.boolean(),
  /** Why it looks like one, as a sentence. */
  why: z.string().optional(),
});
export type UnlistedController = z.infer<typeof UnlistedControllerSchema>;

/** A wheel base the user added with "My wheel is not listed". Kept in RigReady's data folder. */
export const MyWheelSchema = z.object({
  vendorId: z.string(),
  productId: z.string(),
  /** The name the device reported when it was added. */
  name: z.string(),
  /** The maker, when the user gave one. A label only. */
  maker: z.string().optional(),
  connected: z.boolean(),
});
export type MyWheel = z.infer<typeof MyWheelSchema>;

export const WheelStatusSchema = z.object({
  connected: z.boolean(),
  /** The brand of the connected base, or of the one whose software or traces are here. */
  brand: WheelBrandSchema.optional(),
  brandName: z.string().optional(),
  /** False until someone reports this brand working on a real wheel: tested on recorded data only. */
  verifiedOnHardware: z.boolean(),
  name: z.string().optional(),
  /** The name the owner gave the device on the Devices page, shown before `name`. */
  givenName: z.string().optional(),
  vendorId: z.string().optional(),
  productId: z.string().optional(),
  /**
   * pc: the base reports itself as what it is (Fanatec red mode). compatibility: Fanatec yellow
   * mode, reporting as a ClubSport V2.5. console: a console or legacy mode the USB id gives away.
   * unknown: this brand's mode cannot be told from the USB id.
   */
  mode: z.enum(['pc', 'compatibility', 'console', 'unknown', 'none']),
  /** The mode in words: "PC (red) mode", "PS4 mode". */
  modeLabel: z.string().optional(),
  /** What to do about a mode that is not the PC one. */
  modeHelp: z.string().optional(),
  /** DirectInput controllers games see for the base. */
  controllers: z.number(),
  /** Why games may see this base as more than one controller, when the brand does that. */
  controllersNote: z.string().optional(),
  connection: z.string().optional(),
  /** Names of the brand's other parts on USB: pedals, shifter, rim. */
  accessories: z.array(z.string()),
  /** Base, rim, pedals and the rest, each with its role. */
  parts: z.array(WheelPartSchema),
  /** What each axis of the base is, as this brand uses it. */
  axes: z.array(z.object({ axis: z.string(), name: z.string() })),
  /** True when the axis names come from the maker or a reliable source, false when generic. */
  axesSourced: z.boolean(),
  software: z.array(z.object({ label: z.string(), value: z.string(), ok: z.boolean() })),
  /** What the brand's software is needed for, in one line. */
  softwareNote: z.string().optional(),
  /** Profile files of the brand's software that are plain files a backup can copy. */
  profiles: z.array(z.object({ label: z.string(), path: z.string(), present: z.boolean() })),
  /** Set when RigReady can back the brand's profile files up (the backups panel's game). */
  backup: z.string().optional(),
  /** Pages where the brand itself publishes settings per game; RigReady links, it does not compare. */
  recommendedLinks: z.array(z.object({ game: z.string(), title: z.string(), url: z.string() })),
  /** Wheel bases of other brands connected at the same time. */
  others: z.array(z.string()),
  firmwareShipped: z.string().optional(),
  lastSeen: z.array(Pair),
  /**
   * True when the base shown is one the user said is their wheel base and its model is not in
   * RigReady's table. It has no brand: only what needs nothing model-specific applies to it.
   */
  unlisted: z.boolean().optional(),
  /** The maker the user named for an unlisted base. A label only. */
  maker: z.string().optional(),
  /** For an unlisted base: what RigReady does for it, and what is not available for this model. */
  unlistedWorks: z.array(z.string()).optional(),
  unlistedNotAvailable: z.array(z.string()).optional(),
  /**
   * Connected controllers that look like a wheel base, are not in the table, and that nobody
   * has said are the user's wheel: RigReady sees them and does not know the model.
   */
  unknownBases: z.array(UnlistedControllerSchema),
  /** With no base connected: the name of the wheel base the user added, the one to plug in. */
  awaitedName: z.string().optional(),
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
  /**
   * Every connected controller the wheel table does not know and the user has not added:
   * the choices for "My wheel is not listed", the ones that look like a wheel first.
   */
  unlisted: z.array(UnlistedControllerSchema),
  /** The wheel bases the user added with "My wheel is not listed". */
  myWheels: z.array(MyWheelSchema),
});
export type WheelView = z.infer<typeof WheelViewSchema>;

/** One model of controller, by its USB ids. */
export const WheelRefSchema = z.object({ vendorId: UsbId, productId: UsbId });

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

export const BACKUP_GAMES = [
  'iracing',
  'lmu',
  'beamng',
  'assetto-corsa',
  'fanatec',
  'logitech',
  'simucube',
] as const;
export const BackupGameSchema = z.enum(BACKUP_GAMES);
export type BackupGame = z.infer<typeof BackupGameSchema>;
/** Backups of a wheel maker's software, not of a game's bindings. */
export const TOOL_BACKUPS = ['fanatec', 'logitech', 'simucube'] as const;
export type ToolBackup = (typeof TOOL_BACKUPS)[number];
export const isToolBackup = (game: BackupGame): game is ToolBackup =>
  (TOOL_BACKUPS as readonly string[]).includes(game);

export const BindingBackupSchema = z.object({
  id: z.string(),
  game: BackupGameSchema,
  /** What the owner calls this set of bindings: "Formula rim". */
  name: z.string().max(80).optional(),
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
/** Assetto Corsa's repair: controller number in controls.ini -> instance GUID of the one it is now. */
const AcChoices = z
  .array(
    z.object({
      index: z.number().int().min(0).max(63),
      guid: z
        .string()
        .regex(/^\{?[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}?$/i),
    })
  )
  .max(64)
  .default([]);
const BackupName = z.string().trim().max(80);
const BackupRef = z.object({ game: BackupGameSchema, id: z.string().regex(/^[\w-]+$/) });

export const racingContract = defineContract('racing', {
  overview: channel(noInput, RacingOverviewSchema, {
    describe:
      'The racing games and wheel software RigReady knows, which are installed, and the problems found with their bindings. Changes nothing.',
    tier: 'read',
  }),
  iracing: channel(noInput, IracingViewSchema, {
    describe:
      "iRacing's controllers and bindings, whether it is running, and controllers whose Windows ids changed (old and new GUIDs for racing:iracingRepair). Changes nothing.",
    tier: 'read',
  }),
  /** Points iRacing at controllers' new Windows ids (old instance GUID -> new). */
  iracingRepair: channel(
    z.object({ mapping: z.array(z.object({ from: z.string(), to: z.string() })).min(1) }),
    Message,
    {
      describe:
        "Points iRacing's bindings at controllers' new Windows ids, from old instance GUID to new, as found by racing:iracing. Call racing:iracingRepairPreview first and show the user. iRacing must be closed.",
      tier: 'change',
    }
  ),
  /** Which iRacing files that repair would change and how. Reads only. */
  iracingRepairPreview: channel(
    z.object({ mapping: z.array(z.object({ from: z.string(), to: z.string() })).min(1) }),
    WritePreviewSchema,
    {
      describe:
        'Shows which iRacing files racing:iracingRepair would change and how. Nothing is changed.',
      tier: 'read',
    }
  ),
  lmu: channel(noInput, LmuViewSchema, {
    describe:
      "Le Mans Ultimate's controllers and bindings, whether it is running, and controllers that were renamed. Changes nothing.",
    tier: 'read',
  }),
  /** Puts the new name of every renamed controller into Le Mans Ultimate's bindings file. */
  lmuRepair: channel(noInput, Message, {
    describe:
      "Puts the new name of every renamed controller into Le Mans Ultimate's bindings file. Call racing:lmuRepairPreview first and show the user. Le Mans Ultimate must be closed.",
    tier: 'change',
  }),
  /** What that repair would change in direct input.json. Reads only. */
  lmuRepairPreview: channel(noInput, WritePreviewSchema, {
    describe: 'Shows what racing:lmuRepair would change in direct input.json. Nothing is changed.',
    tier: 'read',
  }),
  beamng: channel(noInput, BeamngViewSchema, {
    describe:
      "BeamNG.drive's binding files per controller and per game version, whether it is running, and older versions whose bindings could be copied. Changes nothing.",
    tier: 'read',
  }),
  beamngCopyOlder: channel(z.object({ version: z.string().regex(/^[\d.]+$/) }), Message, {
    describe:
      'Copies the binding files of an older BeamNG.drive version (version from racing:beamng) into the current one. Call racing:beamngCopyOlderPreview first and show the user. BeamNG.drive must be closed.',
    tier: 'change',
  }),
  /** Which binding files that copy would create and replace. Reads only. */
  beamngCopyOlderPreview: channel(
    z.object({ version: z.string().regex(/^[\d.]+$/) }),
    WritePreviewSchema,
    {
      describe:
        'Shows which binding files racing:beamngCopyOlder would create and replace. Nothing is changed.',
      tier: 'read',
    }
  ),
  beamngCopyToController: channel(
    z.object({
      file: z.string().regex(/^[\w ./-]+\.diff$/),
      to: z.string().regex(/^[0-9a-f]{8}$/i),
    }),
    Message,
    {
      describe:
        'Copies one BeamNG.drive binding file (file from racing:beamng) to another controller, given by its 8 digit product id (to). Call racing:beamngCopyToControllerPreview first and show the user. BeamNG.drive must be closed.',
      tier: 'change',
    }
  ),
  /** The binding file that copy would create. Reads only. */
  beamngCopyToControllerPreview: channel(
    z.object({
      file: z.string().regex(/^[\w ./-]+\.diff$/),
      to: z.string().regex(/^[0-9a-f]{8}$/i),
    }),
    WritePreviewSchema,
    {
      describe:
        'Shows the binding file racing:beamngCopyToController would create. Nothing is changed.',
      tier: 'read',
    }
  ),
  assettoCorsa: channel(noInput, AcViewSchema, {
    describe:
      "Assetto Corsa's controller settings and bindings as RigReady reads them, and controllers that are at another number or have a new Windows id (for racing:acRepair). Changes nothing.",
    tier: 'read',
  }),
  /** Renumbers Assetto Corsa's controllers in controls.ini to the order Windows lists them now. */
  acRepair: channel(z.object({ choices: AcChoices }), Message, {
    describe:
      "Points Assetto Corsa's bindings in controls.ini at the controllers where Windows lists them now: renumbers JOY=n and puts in a new Windows id. choices names, for a controller RigReady cannot place by itself (candidates from racing:assettoCorsa), which connected one it is. Call racing:acRepairPreview first and show the user. Assetto Corsa and Content Manager must be closed.",
    tier: 'change',
  }),
  /** What that repair would change in controls.ini. Reads only. */
  acRepairPreview: channel(z.object({ choices: AcChoices }), WritePreviewSchema, {
    describe: 'Shows what racing:acRepair would change in controls.ini. Nothing is changed.',
    tier: 'read',
  }),
  wheel: channel(noInput, WheelViewSchema, {
    describe:
      'The wheel base of any brand (Fanatec, Moza, Logitech, Simagic, Thrustmaster, Simucube, Asetek, Cammus): base, rim and pedals, mode, axes, the maker software and its profile files; for Fanatec also the five tuning presets noted in RigReady and how the active one compares with the recommended values. Also the connected controllers RigReady does not know (unlisted, and status.unknownBases for the ones that look like a wheel base) and the wheel bases the user added (myWheels). Changes nothing.',
    tier: 'read',
  }),
  /** "My wheel is not listed": remembers a connected controller as the user's wheel base. */
  addWheel: channel(
    WheelRefSchema.extend({ maker: z.string().trim().max(60).optional() }),
    WheelViewSchema,
    {
      describe:
        "Remembers a connected controller as the user's wheel base, for a model RigReady does not know. Take vendorId and productId from unlisted in racing:wheel; maker is the maker's name when the user knows it. Kept in RigReady's own data folder on this PC. The wheel, its software and the games are not changed. Such a base gets what needs nothing model-specific (connected, how many controllers games see, the racing.wheelBase check); status.unlistedNotAvailable says what it does not get.",
      tier: 'change',
    }
  ),
  /** Forgets a wheel base added with racing:addWheel. */
  removeWheel: channel(WheelRefSchema, WheelViewSchema, {
    describe:
      "Forgets a wheel base the user added as their own. Take the ids from myWheels in racing:wheel. Only RigReady's own list changes; a setup check for that base keeps working.",
    tier: 'change',
  }),
  savePresets: channel(WheelPresetsSchema, WheelPresetsSchema, {
    describe:
      "Saves the user's notes of the five Fanatec tuning presets and which one is active, replacing what RigReady kept. The wheel base itself is not changed. Send all five presets as racing:wheel gave them, with the edits.",
    tier: 'change',
  }),
  backups: channel(GameRef, z.array(BindingBackupSchema), {
    describe:
      "Lists RigReady's binding backups of one game (iracing, lmu, beamng, assetto-corsa), or of a wheel maker's software (fanatec, logitech, simucube). Backup ids for the other racing backup channels come from here. Changes nothing.",
    tier: 'read',
  }),
  backup: channel(GameRef.extend({ name: BackupName.optional() }), BindingBackupSchema, {
    describe:
      "Backs up the binding files of one game into RigReady's folder now, under an optional name. The game's files are only read.",
    tier: 'change',
  }),
  /** Gives a backup a name ("Formula rim"), or with an empty one takes it away. */
  nameBackup: channel(BackupRef.extend({ name: BackupName }), BindingBackupSchema, {
    describe:
      'Gives a racing binding backup a name (such as Formula rim), or takes it away with an empty name. game and id come from racing:backups.',
    tier: 'change',
  }),
  /** The setups for this game, with the binding backup each expects (rim variants). */
  backupSetups: channel(
    GameRef,
    z.array(z.object({ id: z.string(), name: z.string(), backupId: z.string().optional() })),
    {
      describe:
        'The setups for one game, with the binding backup each expects (for example one per wheel rim). Changes nothing.',
      tier: 'read',
    }
  ),
  /** Makes a setup expect the bindings of this backup: a checklist item with its fix. */
  useBackupInSetup: channel(BackupRef.extend({ profileId: z.string().min(1) }), Message, {
    describe:
      'Makes a setup expect the bindings of a backup, as a checklist item whose fix restores them. game and id come from racing:backups, profileId from racing:backupSetups.',
    tier: 'change',
  }),
  /** Takes that item out of the setup again. */
  stopUsingBackup: channel(GameRef.extend({ profileId: z.string().min(1) }), Message, {
    describe:
      'Takes the expected-bindings item for one game out of a setup again. profileId comes from racing:backupSetups.',
    tier: 'change',
  }),
  restore: channel(BackupRef.extend({ closeApp: z.boolean().default(false) }), Message, {
    describe:
      'Puts the files of a racing binding backup back. The game must be closed; for wheel software (the Fanatec App, G HUB), closeApp lets RigReady close it and start it again. Call racing:restorePreview first and show the user.',
    tier: 'change',
  }),
  /** What restoring that backup would change, file by file. Reads only. */
  restorePreview: channel(BackupRef, WritePreviewSchema, {
    describe: 'Shows what racing:restore would change, file by file. Nothing is changed.',
    tier: 'read',
  }),
  deleteBackup: channel(BackupRef, z.object({ deleted: z.boolean() }), {
    describe:
      "Deletes a racing binding backup from RigReady's folder for good. game and id come from racing:backups. Ask the user first.",
    tier: 'change',
  }),
});
