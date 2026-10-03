import { z } from 'zod';
import { InputDeviceSchema } from '../../../shared/models';
import { DeviceIdentitySchema } from './identity';

/** What the Devices screens show. Shared by main (which builds it) and the renderer. */

export const NotificationModeSchema = z.enum(['off', 'required', 'controllers', 'all']);
export type NotificationMode = z.infer<typeof NotificationModeSchema>;

export const LocationSchema = z.object({
  text: z.string(),
  path: z.string(),
  depth: z.number().int(),
  hubName: z.string().optional(),
  port: z.number().int().optional(),
});

export const RigDeviceSchema = z.object({
  /** Stable for this listing: the USB instance id, or "guid:<instance GUID>" for a controller without one. */
  key: z.string(),
  instanceId: z.string().optional(),
  vendorId: z.string(),
  productId: z.string(),
  serial: z.string().optional(),
  manufacturer: z.string().optional(),
  /** Name the device reports. */
  productName: z.string(),
  /** Name the user gave it. */
  givenName: z.string().optional(),
  /** givenName, else productName. */
  name: z.string(),
  kind: z.enum(['controller', 'other']),
  /** The DirectInput controllers (as games list them) that belong to this device. */
  controllers: z.array(InputDeviceSchema),
  /**
   * Several identical devices without a way to pair each with its controllers: the
   * controllers listed are those of all the twins. "Press a button to identify" tells them apart.
   */
  controllersShared: z.boolean(),
  /** Present devices of the same model, this one included. */
  twins: z.number().int(),
  identity: DeviceIdentitySchema,
  identifiedBy: z.enum(['ids', 'serial', 'port', 'guid']),
  location: LocationSchema.optional(),
  hidden: z.boolean(),
  /** Names of the setups whose checklist needs this device. */
  requiredBy: z.array(z.string()),
});
export type RigDevice = z.infer<typeof RigDeviceSchema>;

export const MissingDeviceSchema = z.object({
  title: z.string(),
  identity: DeviceIdentitySchema,
  profiles: z.array(z.string()),
  /** "yesterday 21:14" */
  lastSeen: z.string().optional(),
  lastLocation: z.string().optional(),
  lastPath: z.string().optional(),
  /** Another unit of the same model is connected. */
  otherUnit: z.boolean(),
});
export type MissingDevice = z.infer<typeof MissingDeviceSchema>;

export const HidHideSummarySchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('notInstalled') }),
  z.object({ state: z.literal('error'), message: z.string() }),
  z.object({
    state: z.literal('ok'),
    cloak: z.boolean(),
    inverse: z.boolean(),
    hiddenCount: z.number().int(),
    apps: z.array(z.string()),
    /** Programs that need to see the devices, and whether they can see hidden ones. */
    programs: z.array(
      z.object({
        label: z.string(),
        exe: z.string(),
        onList: z.boolean(),
        seesHidden: z.boolean(),
      })
    ),
  }),
]);
export type HidHideSummary = z.infer<typeof HidHideSummarySchema>;

export const OverviewSchema = z.object({
  devices: z.array(RigDeviceSchema),
  missing: z.array(MissingDeviceSchema),
  hidHide: HidHideSummarySchema,
  /** Set when the DirectInput reader could not be started (controllers then have no input details). */
  inputError: z.string().optional(),
  notifications: NotificationModeSchema,
  /** The reader is still starting; ask again shortly. */
  inputPending: z.boolean().optional(),
  activeProfile: z.string().optional(),
});
export type Overview = z.infer<typeof OverviewSchema>;

export const UsbNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().optional(),
  kind: z.enum(['root', 'hub', 'device']),
  name: z.string(),
  /** RigDevice.key for a peripheral. */
  deviceKey: z.string().optional(),
  port: z.number().int().optional(),
  /** External hubs between the root hub and this node. */
  depth: z.number().int(),
  isGameController: z.boolean(),
  required: z.boolean(),
  hidden: z.boolean(),
  warning: z.enum(['deep', 'tooDeep']).optional(),
  /** Peripherals at or below this node. */
  devicesBelow: z.number().int(),
});
export type UsbNode = z.infer<typeof UsbNodeSchema>;

export const UsbControllerSchema = z.object({
  id: z.string(),
  name: z.string(),
  hubs: z.number().int(),
  devices: z.number().int(),
  /** USB addresses in use (hubs and devices); a host controller has 127. */
  addresses: z.number().int(),
  status: z.enum(['ok', 'near', 'over']),
  deepest: z.number().int(),
  /** Devices on this controller that the active setup does not need: what to unplug or move first. */
  spare: z.array(z.object({ key: z.string(), name: z.string(), location: z.string() })),
});
export type UsbController = z.infer<typeof UsbControllerSchema>;

export const UsbMapSchema = z.object({
  nodes: z.array(UsbNodeSchema),
  controllers: z.array(UsbControllerSchema),
  activeProfile: z.string().optional(),
});
export type UsbMap = z.infer<typeof UsbMapSchema>;
