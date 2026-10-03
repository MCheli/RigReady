import { z } from 'zod';

/** Machine-state models that cross the IPC boundary and are stored in fixtures. */

export const HubNodeSchema = z.object({
  instanceId: z.string(),
  name: z.string(),
});
export type HubNode = z.infer<typeof HubNodeSchema>;

export const DeviceInfoSchema = z.object({
  /** Windows device instance path, e.g. USB\VID_4098&PID_BE62\0123ABCD. */
  instanceId: z.string(),
  /** Four upper-case hex digits. */
  vendorId: z.string().regex(/^[0-9A-F]{4}$/),
  productId: z.string().regex(/^[0-9A-F]{4}$/),
  /** Product name reported by the device on the bus. */
  name: z.string(),
  manufacturer: z.string().optional(),
  /** Real USB serial number. Absent when Windows generated the instance suffix. */
  serial: z.string().optional(),
  /** True when the device exposes at least one HID interface. */
  isHid: z.boolean(),
  isHub: z.boolean(),
  /** Parent chain, nearest first, ending at the root hub. */
  hubChain: z.array(HubNodeSchema),
});
export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;

export const RotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
export type Rotation = z.infer<typeof RotationSchema>;

export const DisplayInfoSchema = z.object({
  /**
   * Stable identity: the monitor device interface path, lower-cased. It includes the
   * per-connector instance, so identical monitors get different ids.
   */
  id: z.string(),
  /** EDID friendly name, e.g. "USB_Monitor". May be empty for generic panels. */
  name: z.string(),
  /** EDID manufacturer + product code, e.g. "SAM7053". */
  edid: z.string().optional(),
  /** GDI device name (\\.\DISPLAY1) while enabled. Not stable across changes. */
  gdiName: z.string().optional(),
  enabled: z.boolean(),
  primary: z.boolean(),
  x: z.number().int(),
  y: z.number().int(),
  /** Desktop size in pixels after rotation. 0 when disabled. */
  width: z.number().int(),
  height: z.number().int(),
  rotation: RotationSchema,
  /** Raw DISPLAYCONFIG_ROTATION value as reported by Windows (1..4), for diagnosis. */
  rawRotation: z.number().int().optional(),
  refreshHz: z.number().optional(),
});
export type DisplayInfo = z.infer<typeof DisplayInfoSchema>;

export const DisplayLayoutSchema = z.object({ displays: z.array(DisplayInfoSchema) });
export type DisplayLayout = z.infer<typeof DisplayLayoutSchema>;

/** What a profile wants a display to be. Size is only set when the mode must change. */
export const DisplayTargetSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  enabled: z.boolean(),
  primary: z.boolean().default(false),
  x: z.number().int().default(0),
  y: z.number().int().default(0),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  rotation: RotationSchema.default(0),
});
export type DisplayTarget = z.infer<typeof DisplayTargetSchema>;

export const ProcessInfoSchema = z.object({
  pid: z.number().int(),
  name: z.string(),
  /** Full image path when Windows lets us read it. */
  path: z.string().optional(),
});
export type ProcessInfo = z.infer<typeof ProcessInfoSchema>;

export const AudioDeviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  flow: z.enum(['playback', 'recording']),
});
export type AudioDevice = z.infer<typeof AudioDeviceSchema>;

export const AudioStateSchema = z.object({
  defaultPlayback: AudioDeviceSchema.optional(),
  defaultRecording: AudioDeviceSchema.optional(),
  defaultCommsPlayback: AudioDeviceSchema.optional(),
  defaultCommsRecording: AudioDeviceSchema.optional(),
  /** Every active endpoint. */
  devices: z.array(AudioDeviceSchema),
});
export type AudioState = z.infer<typeof AudioStateSchema>;

export const InputDeviceSchema = z.object({
  index: z.number().int(),
  name: z.string(),
  guid: z.string(),
  numAxes: z.number().int(),
  numButtons: z.number().int(),
  numHats: z.number().int(),
});
export type InputDevice = z.infer<typeof InputDeviceSchema>;

export const InputStateSchema = z.object({
  index: z.number().int(),
  name: z.string(),
  axes: z.array(z.number()),
  buttons: z.array(z.boolean()),
  hats: z.array(z.tuple([z.number(), z.number()])),
  timestamp: z.number(),
});
export type InputState = z.infer<typeof InputStateSchema>;

export const LaunchTargetSchema = z.object({
  exe: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
});
export type LaunchTarget = z.infer<typeof LaunchTargetSchema>;
