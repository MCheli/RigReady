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
  /** True when Windows classes it as a game controller (joystick, wheel, pedals, button box). */
  isGameController: z.boolean().default(false),
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

/** A display mode a monitor offers, in its unrotated (landscape) form. */
export const DisplayModeSchema = z.object({
  width: z.number().int(),
  height: z.number().int(),
  refreshHz: z.number(),
});
export type DisplayMode = z.infer<typeof DisplayModeSchema>;

export const DisplayInfoSchema = z.object({
  /**
   * The monitor device interface path, lower-cased. It includes the per-connector
   * instance, so identical monitors get different ids; it changes when the monitor is
   * moved to another connector (or, for a USB screen without `usbSerial`, another port).
   */
  id: z.string(),
  /** Serial number from the monitor's EDID. Absent when the EDID has none (or says 0). */
  serial: z.string().optional(),
  /**
   * For a USB (DisplayLink and similar) screen: the serial number of the USB device it
   * hangs off. It stays the same on any USB port, which the id does not.
   */
  usbSerial: z.string().optional(),
  /** For a USB screen: "VVVV:PPPP" of that USB device. */
  usbId: z.string().optional(),
  /** How it is connected: HDMI, DisplayPort, USB, DVI, VGA, Internal, Wireless, Other. */
  connector: z.string().optional(),
  /** The modes it offers, when Windows lists them (only while the monitor is on). */
  modes: z.array(DisplayModeSchema).optional(),
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
  /** The device interface path (model code plus connector instance). Never empty: a name is no identity. */
  id: z.string().min(1),
  name: z.string().default(''),
  enabled: z.boolean(),
  primary: z.boolean().default(false),
  x: z.number().int().default(0),
  y: z.number().int().default(0),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  rotation: RotationSchema.default(0),
  /** Only set when the refresh rate matters; otherwise Windows keeps or picks one. */
  refreshHz: z.number().positive().optional(),
  /** The monitor's EDID serial and USB device serial when it was saved, to find it again on another connector. */
  serial: z.string().optional(),
  usbSerial: z.string().optional(),
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

/** A game controller as DirectInput (and therefore DCS, iRacing, ...) lists it. */
export const InputDeviceSchema = z.object({
  index: z.number().int(),
  /** DirectInput product name, untrimmed: games key files on the exact text. */
  name: z.string(),
  /**
   * DirectInput instance GUID, upper-case without braces, e.g.
   * "806E0610-B756-11F0-8024-444553540000". DCS binding file names and iRacing use it.
   */
  guid: z.string(),
  /** DirectInput product GUID ({PPPPVVVV-0000-0000-0000-504944564944} for HID devices). */
  productGuid: z.string().default(''),
  /** Four upper-case hex digits each; empty when the product GUID does not encode them. */
  vendorId: z.string().default(''),
  productId: z.string().default(''),
  numAxes: z.number().int(),
  numButtons: z.number().int(),
  numHats: z.number().int(),
  /** One DirectInput axis name per entry of InputState.axes: X, Y, Z, RX, RY, RZ, SLIDER1, SLIDER2. */
  axisNames: z.array(z.string()).default([]),
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

export const AudioRoleSchema = z.enum(['console', 'multimedia', 'communications']);
export type AudioRole = z.infer<typeof AudioRoleSchema>;

export const ServiceInfoSchema = z.object({
  /** Short name, e.g. "HidHide". */
  name: z.string(),
  displayName: z.string(),
  state: z.enum(['running', 'stopped', 'starting', 'stopping', 'paused', 'other']),
  /** Process id while running. */
  pid: z.number().int().optional(),
});
export type ServiceInfo = z.infer<typeof ServiceInfoSchema>;

export const RegistryHiveSchema = z.enum(['HKCU', 'HKLM']);
export type RegistryHive = z.infer<typeof RegistryHiveSchema>;

export const RegistryValueSchema = z.discriminatedUnion('type', [
  /** REG_SZ and REG_EXPAND_SZ (not expanded). */
  z.object({ type: z.literal('string'), value: z.string() }),
  /** REG_DWORD and REG_QWORD. */
  z.object({ type: z.literal('number'), value: z.number() }),
  /** REG_BINARY and anything else, as lower-case hex. */
  z.object({ type: z.literal('binary'), value: z.string() }),
  /** REG_MULTI_SZ. */
  z.object({ type: z.literal('strings'), value: z.array(z.string()) }),
]);
export type RegistryValue = z.infer<typeof RegistryValueSchema>;

/** What Windows remembers about one DirectInput game controller model (VID/PID). */
export const DirectInputIdentitySchema = z.object({
  vendorId: z.string().regex(/^[0-9A-F]{4}$/),
  productId: z.string().regex(/^[0-9A-F]{4}$/),
  /** DirectInput product name (the "OEMName"), untrimmed. Empty when Windows has none. */
  name: z.string(),
  /** {PPPPVVVV-0000-0000-0000-504944564944} without braces. */
  productGuid: z.string(),
  /**
   * One per calibration slot Windows has handed out for this VID/PID. More than one
   * means identical devices, or a stale slot left behind by an earlier re-enumeration.
   */
  instances: z.array(
    z.object({
      slot: z.number().int(),
      /** Instance GUID, upper-case without braces. */
      guid: z.string(),
      /** winmm joystick id recorded with the slot, when present. */
      joystickId: z.number().int().optional(),
    })
  ),
});
export type DirectInputIdentity = z.infer<typeof DirectInputIdentitySchema>;
