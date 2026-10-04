import type { DisplayApplyOutcome, DisplayProvider } from '../../core/ports';
import { err, ok, type Result } from '../../core/result';
import { connectorName, monitorInstanceId, parseEdid, usbIdentity } from '../../core/displays/edid';
import type {
  DisplayInfo,
  DisplayLayout,
  DisplayMode,
  DisplayTarget,
  Rotation,
} from '../../shared/models';
import { DevTree, KEY_PARENT } from './devices';
import { readRegistryValue } from './registry';
import {
  ChangeDisplaySettingsExW,
  DisplayConfigGetDeviceInfo,
  EnumDisplaySettingsExW,
  GetDisplayConfigBufferSizes,
  QueryDisplayConfig,
  SetDisplayConfig,
  wstr,
} from './win32';

/**
 * Display configuration through QueryDisplayConfig / SetDisplayConfig (the CCD API).
 * Structures are raw buffers; offsets are the x64 layouts of DISPLAYCONFIG_PATH_INFO
 * (72 bytes) and DISPLAYCONFIG_MODE_INFO (64 bytes).
 */

const PATH_SIZE = 72;
const MODE_SIZE = 64;
const QDC_ALL_PATHS = 1;
const QDC_ONLY_ACTIVE_PATHS = 2;
const SDC_USE_SUPPLIED_DISPLAY_CONFIG = 0x20;
const SDC_VALIDATE = 0x40;
const SDC_APPLY = 0x80;
const SDC_SAVE_TO_DATABASE = 0x200;
const SDC_ALLOW_CHANGES = 0x400;
const PATH_ACTIVE = 1;
const IDX_INVALID = 0xffffffff;
const MODE_SOURCE = 1;
const MODE_TARGET = 2;
const ERROR_INSUFFICIENT_BUFFER = 122;

// DISPLAYCONFIG_PATH_INFO offsets
const P_SRC_ADAPTER = 0;
const P_SRC_ID = 8;
const P_SRC_MODE = 12;
const P_TGT_ADAPTER = 20;
const P_TGT_ID = 28;
const P_TGT_MODE = 32;
const P_TGT_ROTATION = 40;
const P_TGT_REFRESH_NUM = 48;
const P_TGT_REFRESH_DEN = 52;
const P_TGT_SCALING = 44;
const SCALING_PREFERRED = 128;
const P_TGT_SCANLINE = 56;
const P_TGT_AVAILABLE = 60;
const P_FLAGS = 68;
// DISPLAYCONFIG_MODE_INFO offsets
const M_TYPE = 0;
const M_ID = 4;
const M_ADAPTER = 8;
const M_SRC_WIDTH = 16;
const M_SRC_HEIGHT = 20;
const M_SRC_FORMAT = 24;
const M_SRC_X = 28;
const M_SRC_Y = 32;
const PIXELFORMAT_32BPP = 4;

interface RawConfig {
  numPaths: number;
  paths: Buffer;
  numModes: number;
  modes: Buffer;
}

interface TargetName {
  name: string;
  devicePath: string;
  edid: string;
  /** DISPLAYCONFIG_VIDEO_OUTPUT_TECHNOLOGY. */
  technology: number;
}

const ROTATION_FROM_RAW: Record<number, Rotation> = { 1: 0, 2: 90, 3: 180, 4: 270 };
const ROTATION_TO_RAW: Record<Rotation, number> = { 0: 1, 90: 2, 180: 3, 270: 4 };

function query(flags: number): RawConfig {
  for (let attempt = 0; attempt < 4; attempt++) {
    const numPaths = [0];
    const numModes = [0];
    const sized = GetDisplayConfigBufferSizes(flags, numPaths, numModes);
    if (sized !== 0) throw new Error(`GetDisplayConfigBufferSizes failed with ${sized}`);
    const paths = Buffer.alloc(Math.max(1, numPaths[0]!) * PATH_SIZE);
    const modes = Buffer.alloc(Math.max(1, numModes[0]!) * MODE_SIZE);
    const status = QueryDisplayConfig(flags, numPaths, paths, numModes, modes, null);
    if (status === ERROR_INSUFFICIENT_BUFFER) continue;
    if (status !== 0) throw new Error(`QueryDisplayConfig failed with ${status}`);
    return {
      numPaths: numPaths[0]!,
      paths: paths.subarray(0, numPaths[0]! * PATH_SIZE),
      numModes: numModes[0]!,
      modes: modes.subarray(0, numModes[0]! * MODE_SIZE),
    };
  }
  throw new Error('QueryDisplayConfig kept reporting an insufficient buffer');
}

function edidManufacturer(raw: number): string {
  // Stored big-endian in EDID; Windows hands it over byte-swapped.
  const v = ((raw & 0xff) << 8) | (raw >> 8);
  const letter = (n: number): string => String.fromCharCode(64 + (n & 0x1f));
  return letter(v >> 10) + letter(v >> 5) + letter(v);
}

function targetName(paths: Buffer, offset: number): TargetName {
  const packet = Buffer.alloc(420);
  packet.writeUInt32LE(2, 0); // DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME
  packet.writeUInt32LE(420, 4);
  paths.copy(packet, 8, offset + P_TGT_ADAPTER, offset + P_TGT_ADAPTER + 8);
  packet.writeUInt32LE(paths.readUInt32LE(offset + P_TGT_ID), 16);
  const status = DisplayConfigGetDeviceInfo(packet);
  if (status !== 0) throw new Error(`DisplayConfigGetDeviceInfo(target) failed with ${status}`);
  const flags = packet.readUInt32LE(20);
  const edidValid = (flags & 0x4) !== 0; // edidIdsValid
  const edid = edidValid
    ? edidManufacturer(packet.readUInt16LE(28)) +
      packet.readUInt16LE(30).toString(16).toUpperCase().padStart(4, '0')
    : '';
  return {
    name: wstr(packet, 36, 128),
    devicePath: wstr(packet, 164, 256),
    edid,
    technology: packet.readUInt32LE(24),
  };
}

type Identity = Pick<DisplayInfo, 'serial' | 'usbSerial' | 'usbId'>;

/**
 * What tells this monitor from another of the same model: the serial in its EDID (read
 * from the copy Windows keeps in the registry) and, for a USB screen, the serial of the
 * USB device above it in the device tree.
 */
function monitorIdentity(devicePath: string, tree: DevTree): Identity {
  const identity: Identity = {};
  const instanceId = monitorInstanceId(devicePath);
  if (!instanceId) return identity;
  const edid = readRegistryValue(
    'HKLM',
    'SYSTEM\\CurrentControlSet\\Enum\\' + instanceId + '\\Device Parameters',
    'EDID'
  );
  if (edid?.type === 'binary') {
    const serial = parseEdid(edid.value).serial;
    if (serial) identity.serial = serial;
  }
  let current = tree.text(instanceId, KEY_PARENT);
  for (let depth = 0; current && depth < 6; depth++) {
    const usb = usbIdentity(current);
    if (usb) {
      Object.assign(identity, usb);
      break;
    }
    // Past the first whole USB device there are only hubs: not this screen's identity.
    if (/^USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}\\/i.test(current)) break;
    current = tree.text(current, KEY_PARENT);
  }
  return identity;
}

const DEVMODE_SIZE = 220;
const DM_SIZE = 68;
const DM_WIDTH = 172;
const DM_HEIGHT = 176;
const DM_FREQUENCY = 184;

const DM_ORIENTATION = 84;
const ENUM_CURRENT_SETTINGS = 0xffffffff;

/**
 * What the older GDI API calls the orientation of an enabled display: 0 landscape,
 * 1 portrait (DMDO_90), 2 landscape flipped, 3 portrait flipped (DMDO_270), in the order
 * of Windows' own orientation list. For diagnosis and the rig smoke test.
 */
export function gdiOrientation(gdiName: string): number | undefined {
  const devMode = Buffer.alloc(DEVMODE_SIZE);
  devMode.writeUInt16LE(DEVMODE_SIZE, DM_SIZE);
  if (EnumDisplaySettingsExW(gdiName, ENUM_CURRENT_SETTINGS, devMode, 0) === 0) return undefined;
  return devMode.readUInt32LE(DM_ORIENTATION);
}

/** Every mode Windows lists for an enabled display, unrotated, largest first. */
function displayModes(gdiName: string): DisplayMode[] {
  const seen = new Map<string, DisplayMode>();
  const devMode = Buffer.alloc(DEVMODE_SIZE);
  for (let index = 0; index < 4000; index++) {
    devMode.fill(0);
    devMode.writeUInt16LE(DEVMODE_SIZE, DM_SIZE);
    if (EnumDisplaySettingsExW(gdiName, index, devMode, 0) === 0) break;
    const mode: DisplayMode = {
      width: devMode.readUInt32LE(DM_WIDTH),
      height: devMode.readUInt32LE(DM_HEIGHT),
      refreshHz: devMode.readUInt32LE(DM_FREQUENCY),
    };
    if (mode.width === 0 || mode.height === 0) continue;
    seen.set(`${mode.width}x${mode.height}@${mode.refreshHz}`, mode);
  }
  return [...seen.values()].sort(
    (a, b) => b.width * b.height - a.width * a.height || b.refreshHz - a.refreshHz
  );
}

function sourceName(paths: Buffer, offset: number): string {
  const packet = Buffer.alloc(84);
  packet.writeUInt32LE(1, 0); // DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME
  packet.writeUInt32LE(84, 4);
  paths.copy(packet, 8, offset + P_SRC_ADAPTER, offset + P_SRC_ADAPTER + 8);
  packet.writeUInt32LE(paths.readUInt32LE(offset + P_SRC_ID), 16);
  const status = DisplayConfigGetDeviceInfo(packet);
  return status === 0 ? wstr(packet, 20, 64) : '';
}

const targetKey = (paths: Buffer, offset: number): string =>
  paths.toString('hex', offset + P_TGT_ADAPTER, offset + P_TGT_ADAPTER + 8) +
  ':' +
  paths.readUInt32LE(offset + P_TGT_ID);

const sourceKey = (paths: Buffer, offset: number): string =>
  paths.toString('hex', offset + P_SRC_ADAPTER, offset + P_SRC_ADAPTER + 8) +
  ':' +
  paths.readUInt32LE(offset + P_SRC_ID);

function readLayout(): DisplayLayout {
  const active = query(QDC_ONLY_ACTIVE_PATHS);
  const displays: DisplayInfo[] = [];
  const seen = new Set<string>();
  const tree = new DevTree();

  for (let p = 0; p < active.numPaths; p++) {
    const o = p * PATH_SIZE;
    const name = targetName(active.paths, o);
    const id = name.devicePath.toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const srcIdx = active.paths.readUInt32LE(o + P_SRC_MODE);
    let x = 0;
    let y = 0;
    let width = 0;
    let height = 0;
    if (srcIdx !== IDX_INVALID && srcIdx < active.numModes) {
      const m = srcIdx * MODE_SIZE;
      width = active.modes.readUInt32LE(m + M_SRC_WIDTH);
      height = active.modes.readUInt32LE(m + M_SRC_HEIGHT);
      x = active.modes.readInt32LE(m + M_SRC_X);
      y = active.modes.readInt32LE(m + M_SRC_Y);
    }
    const rawRotation = active.paths.readUInt32LE(o + P_TGT_ROTATION);
    const rotation = ROTATION_FROM_RAW[rawRotation] ?? 0;
    // The source mode holds the size before rotation; the desktop sees it turned.
    if (rotation === 90 || rotation === 270) [width, height] = [height, width];
    const num = active.paths.readUInt32LE(o + P_TGT_REFRESH_NUM);
    const den = active.paths.readUInt32LE(o + P_TGT_REFRESH_DEN);
    const info: DisplayInfo = {
      id,
      name: name.name,
      enabled: true,
      primary: x === 0 && y === 0,
      x,
      y,
      width,
      height,
      rotation,
      rawRotation,
    };
    if (name.edid) info.edid = name.edid;
    Object.assign(info, monitorIdentity(name.devicePath, tree));
    // A USB graphics adapter reports whatever its chip drives (often LVDS); to the user it is USB.
    info.connector = info.usbId ? 'USB' : connectorName(name.technology);
    const gdi = sourceName(active.paths, o);
    if (gdi) {
      info.gdiName = gdi;
      const modes = displayModes(gdi);
      if (modes.length > 0) info.modes = modes;
    }
    if (den > 0) info.refreshHz = Math.round((num / den) * 100) / 100;
    displays.push(info);
  }

  // Connected but disabled monitors only show up in the full path table.
  const all = query(QDC_ALL_PATHS);
  const checkedTargets = new Set<string>();
  for (let p = 0; p < all.numPaths; p++) {
    const o = p * PATH_SIZE;
    if (all.paths.readUInt32LE(o + P_TGT_AVAILABLE) === 0) continue;
    const key = targetKey(all.paths, o);
    if (checkedTargets.has(key)) continue;
    checkedTargets.add(key);
    let name: TargetName;
    try {
      name = targetName(all.paths, o);
    } catch {
      continue;
    }
    const id = name.devicePath.toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const info: DisplayInfo = {
      id,
      name: name.name,
      enabled: false,
      primary: false,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
    };
    if (name.edid) info.edid = name.edid;
    Object.assign(info, monitorIdentity(name.devicePath, tree));
    info.connector = info.usbId ? 'USB' : connectorName(name.technology);
    displays.push(info);
  }

  displays.sort(
    (a, b) =>
      Number(b.enabled) - Number(a.enabled) || a.x - b.x || a.y - b.y || a.id.localeCompare(b.id)
  );
  return { displays };
}

function setConfig(config: RawConfig, flags: number): number {
  return SetDisplayConfig(config.numPaths, config.paths, config.numModes, config.modes, flags);
}

/** Activates connected-but-disabled targets, letting Windows choose their modes. */
function enableTargets(ids: Set<string>): void {
  const all = query(QDC_ALL_PATHS);
  const usedSources = new Set<string>();
  const activeTargets = new Set<string>();
  const keep: number[] = [];
  for (let p = 0; p < all.numPaths; p++) {
    const o = p * PATH_SIZE;
    if ((all.paths.readUInt32LE(o + P_FLAGS) & PATH_ACTIVE) !== 0) {
      keep.push(p);
      usedSources.add(sourceKey(all.paths, o));
      activeTargets.add(targetKey(all.paths, o));
    }
  }
  const remaining = new Set(ids);
  for (let p = 0; p < all.numPaths && remaining.size > 0; p++) {
    const o = p * PATH_SIZE;
    if ((all.paths.readUInt32LE(o + P_FLAGS) & PATH_ACTIVE) !== 0) continue;
    if (all.paths.readUInt32LE(o + P_TGT_AVAILABLE) === 0) continue;
    if (activeTargets.has(targetKey(all.paths, o))) continue;
    if (usedSources.has(sourceKey(all.paths, o))) continue;
    let id: string;
    try {
      id = targetName(all.paths, o).devicePath.toLowerCase();
    } catch {
      continue;
    }
    if (!remaining.has(id)) continue;
    remaining.delete(id);
    usedSources.add(sourceKey(all.paths, o));
    activeTargets.add(targetKey(all.paths, o));
    all.paths.writeUInt32LE(IDX_INVALID, o + P_SRC_MODE);
    all.paths.writeUInt32LE(IDX_INVALID, o + P_TGT_MODE);
    all.paths.writeUInt32LE(all.paths.readUInt32LE(o + P_FLAGS) | PATH_ACTIVE, o + P_FLAGS);
    keep.push(p);
  }
  if (remaining.size > 0) {
    throw new Error(`No free display path for: ${[...remaining].join(', ')}`);
  }
  const paths = Buffer.concat(
    keep.map((p) => all.paths.subarray(p * PATH_SIZE, (p + 1) * PATH_SIZE))
  );
  const status = setConfig(
    { numPaths: keep.length, paths, numModes: all.numModes, modes: all.modes },
    SDC_APPLY | SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_ALLOW_CHANGES | SDC_SAVE_TO_DATABASE
  );
  if (status !== 0) throw new Error(`SetDisplayConfig (enable) failed with ${status}`);
}

/**
 * The signal a connected monitor prefers (from its EDID), also while it is off: its
 * native size and the 48 bytes of DISPLAYCONFIG_VIDEO_SIGNAL_INFO a target mode needs.
 */
function preferredMode(
  paths: Buffer,
  offset: number
): { width: number; height: number; refreshHz: number; signal: Buffer } | undefined {
  const packet = Buffer.alloc(80);
  packet.writeUInt32LE(3, 0); // DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_PREFERRED_MODE
  packet.writeUInt32LE(80, 4);
  paths.copy(packet, 8, offset + P_TGT_ADAPTER, offset + P_TGT_ADAPTER + 8);
  packet.writeUInt32LE(paths.readUInt32LE(offset + P_TGT_ID), 16);
  if (DisplayConfigGetDeviceInfo(packet) !== 0) return undefined;
  // DISPLAYCONFIG_VIDEO_SIGNAL_INFO: pixelRate (8 bytes), hSyncFreq, then vSyncFreq as a rational.
  const vSyncDen = packet.readUInt32LE(32 + 20);
  return {
    width: packet.readUInt32LE(20),
    height: packet.readUInt32LE(24),
    refreshHz: vSyncDen > 0 ? packet.readUInt32LE(32 + 16) / vSyncDen : 0,
    signal: Buffer.from(packet.subarray(32, 80)),
  };
}

/**
 * The active paths plus one path for every monitor in `ids` that is connected but off,
 * each with a new source mode of the size its target asks for. With it, turning monitors
 * on, moving, rotating and turning others off is one SetDisplayConfig call instead of
 * two. Undefined when a monitor to turn on has no free path, or is asked for a size or
 * refresh rate other than the one it prefers: the caller then lets Windows turn it on
 * first (enableTargets) and arranges it afterwards.
 */
function configWithEnabled(
  targets: Map<string, DisplayTarget>,
  ids: Set<string>
): RawConfig | undefined {
  const all = query(QDC_ALL_PATHS);
  const usedSources = new Set<string>();
  const activeTargets = new Set<string>();
  const keep: number[] = [];
  for (let p = 0; p < all.numPaths; p++) {
    const o = p * PATH_SIZE;
    if ((all.paths.readUInt32LE(o + P_FLAGS) & PATH_ACTIVE) !== 0) {
      keep.push(p);
      usedSources.add(sourceKey(all.paths, o));
      activeTargets.add(targetKey(all.paths, o));
    }
  }
  const added: Buffer[] = [];
  const remaining = new Set(ids);
  for (let p = 0; p < all.numPaths && remaining.size > 0; p++) {
    const o = p * PATH_SIZE;
    if ((all.paths.readUInt32LE(o + P_FLAGS) & PATH_ACTIVE) !== 0) continue;
    if (all.paths.readUInt32LE(o + P_TGT_AVAILABLE) === 0) continue;
    if (activeTargets.has(targetKey(all.paths, o))) continue;
    if (usedSources.has(sourceKey(all.paths, o))) continue;
    let id: string;
    try {
      id = targetName(all.paths, o).devicePath.toLowerCase();
    } catch {
      continue;
    }
    if (!remaining.has(id)) continue;
    const target = targets.get(id)!;
    const preferred = preferredMode(all.paths, o);
    if (!preferred) return undefined;
    if (target.refreshHz !== undefined && Math.abs(target.refreshHz - preferred.refreshHz) >= 1) {
      return undefined;
    }
    const turned = target.rotation === 90 || target.rotation === 270;
    const wantWidth = turned ? target.height : target.width;
    const wantHeight = turned ? target.width : target.height;
    if (
      (wantWidth !== undefined && wantWidth !== preferred.width) ||
      (wantHeight !== undefined && wantHeight !== preferred.height)
    ) {
      return undefined;
    }
    remaining.delete(id);
    usedSources.add(sourceKey(all.paths, o));
    activeTargets.add(targetKey(all.paths, o));
    // A source mode (the desktop area; arrange() fills in rotation and position) and a
    // target mode (the monitor's preferred signal) for the new path. Windows wants both.
    const source = Buffer.alloc(MODE_SIZE);
    source.writeUInt32LE(MODE_SOURCE, M_TYPE);
    source.writeUInt32LE(all.paths.readUInt32LE(o + P_SRC_ID), M_ID);
    all.paths.copy(source, M_ADAPTER, o + P_SRC_ADAPTER, o + P_SRC_ADAPTER + 8);
    source.writeUInt32LE(preferred.width, M_SRC_WIDTH);
    source.writeUInt32LE(preferred.height, M_SRC_HEIGHT);
    source.writeUInt32LE(PIXELFORMAT_32BPP, M_SRC_FORMAT);
    const signal = Buffer.alloc(MODE_SIZE);
    signal.writeUInt32LE(MODE_TARGET, M_TYPE);
    signal.writeUInt32LE(all.paths.readUInt32LE(o + P_TGT_ID), M_ID);
    all.paths.copy(signal, M_ADAPTER, o + P_TGT_ADAPTER, o + P_TGT_ADAPTER + 8);
    preferred.signal.copy(signal, 16);
    all.paths.writeUInt32LE(all.numModes + added.length, o + P_SRC_MODE);
    all.paths.writeUInt32LE(all.numModes + added.length + 1, o + P_TGT_MODE);
    // An inactive path comes without these; an active one must have them, matching its signal.
    if (all.paths.readUInt32LE(o + P_TGT_SCALING) === 0) {
      all.paths.writeUInt32LE(SCALING_PREFERRED, o + P_TGT_SCALING);
    }
    preferred.signal.copy(all.paths, o + P_TGT_REFRESH_NUM, 16, 24);
    all.paths.writeUInt32LE(preferred.signal.readUInt32LE(44), o + P_TGT_SCANLINE);
    all.paths.writeUInt32LE(all.paths.readUInt32LE(o + P_FLAGS) | PATH_ACTIVE, o + P_FLAGS);
    added.push(source, signal);
    keep.push(p);
  }
  if (remaining.size > 0) return undefined;
  return {
    numPaths: keep.length,
    paths: Buffer.concat(keep.map((p) => all.paths.subarray(p * PATH_SIZE, (p + 1) * PATH_SIZE))),
    numModes: all.numModes + added.length,
    modes: Buffer.concat([all.modes, ...added]),
  };
}

/**
 * Rotation, position, primary and disable for the monitors of a configuration (the
 * active ones, or configWithEnabled's), applied in one call.
 *
 * With `modesFrom` (the monitors as they are now), another size or refresh rate is part
 * of the same call: the source mode gets the new size and the path is left without a
 * target mode, which Windows then computes itself (SDC_ALLOW_CHANGES), the way it does
 * for a monitor that is being turned on. The caller checks afterwards that the monitors
 * really have the modes asked for.
 */
function arrange(
  targets: Map<string, DisplayTarget>,
  config: RawConfig = query(QDC_ONLY_ACTIVE_PATHS),
  modesFrom?: Map<string, DisplayInfo>
): void {
  interface Entry {
    pathOffset: number;
    modeOffset: number;
    target: DisplayTarget | undefined;
    disable: boolean;
  }
  const entries: Entry[] = [];
  for (let p = 0; p < config.numPaths; p++) {
    const o = p * PATH_SIZE;
    const id = targetName(config.paths, o).devicePath.toLowerCase();
    const target = targets.get(id);
    const srcIdx = config.paths.readUInt32LE(o + P_SRC_MODE);
    if (srcIdx === IDX_INVALID) throw new Error(`Display ${id} has no source mode`);
    const modeOffset = srcIdx * MODE_SIZE;
    if (config.modes.readUInt32LE(modeOffset + M_TYPE) !== MODE_SOURCE) {
      throw new Error(`Display ${id} has an unexpected mode table entry`);
    }
    entries.push({ pathOffset: o, modeOffset, target, disable: target ? !target.enabled : false });
  }

  const remaining = entries.filter((e) => !e.disable);
  if (remaining.length === 0) throw new Error('Refusing to disable every display');

  for (const e of remaining) {
    if (!e.target) continue;
    const { pathOffset: o, modeOffset: m, target } = e;
    config.paths.writeUInt32LE(ROTATION_TO_RAW[target.rotation], o + P_TGT_ROTATION);
    config.modes.writeInt32LE(target.x, m + M_SRC_X);
    config.modes.writeInt32LE(target.y, m + M_SRC_Y);
    // Without modesFrom, size and refresh rate stay as they are (see changeModes).
    const now = modesFrom?.get(target.id);
    if (!now?.enabled || !modeDiffers(target, now)) continue;
    const size = nativeSize(target);
    if (size) {
      // The source mode holds the size before rotation.
      config.modes.writeUInt32LE(size.width, m + M_SRC_WIDTH);
      config.modes.writeUInt32LE(size.height, m + M_SRC_HEIGHT);
    }
    // No target mode: Windows works out the signal for the new source mode.
    config.paths.writeUInt32LE(IDX_INVALID, o + P_TGT_MODE);
    if (target.refreshHz !== undefined) {
      config.paths.writeUInt32LE(Math.round(target.refreshHz * 1000), o + P_TGT_REFRESH_NUM);
      config.paths.writeUInt32LE(1000, o + P_TGT_REFRESH_DEN);
      config.paths.writeUInt32LE(0, o + P_TGT_SCANLINE); // unspecified
    }
  }

  // Windows requires the primary display at (0,0): shift everything so it is.
  const primary =
    remaining.find((e) => e.target?.primary) ??
    remaining.find(
      (e) =>
        config.modes.readInt32LE(e.modeOffset + M_SRC_X) === 0 &&
        config.modes.readInt32LE(e.modeOffset + M_SRC_Y) === 0
    ) ??
    remaining[0]!;
  const dx = config.modes.readInt32LE(primary.modeOffset + M_SRC_X);
  const dy = config.modes.readInt32LE(primary.modeOffset + M_SRC_Y);
  if (dx !== 0 || dy !== 0) {
    const shifted = new Set<number>();
    for (const e of remaining) {
      if (shifted.has(e.modeOffset)) continue;
      shifted.add(e.modeOffset);
      config.modes.writeInt32LE(
        config.modes.readInt32LE(e.modeOffset + M_SRC_X) - dx,
        e.modeOffset + M_SRC_X
      );
      config.modes.writeInt32LE(
        config.modes.readInt32LE(e.modeOffset + M_SRC_Y) - dy,
        e.modeOffset + M_SRC_Y
      );
    }
  }

  const paths = Buffer.concat(
    remaining.map((e) => config.paths.subarray(e.pathOffset, e.pathOffset + PATH_SIZE))
  );
  const next: RawConfig = {
    numPaths: remaining.length,
    paths,
    numModes: config.numModes,
    modes: config.modes,
  };
  const flags = SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_ALLOW_CHANGES;
  const valid = setConfig(next, flags | SDC_VALIDATE);
  if (valid !== 0)
    throw new Error(`Windows rejected the layout (SetDisplayConfig validate ${valid})`);
  const status = setConfig(next, flags | SDC_APPLY | SDC_SAVE_TO_DATABASE);
  if (status !== 0) throw new Error(`SetDisplayConfig failed with ${status}`);
}

const DM_FIELDS = 72;
const DM_PELSWIDTH = 0x80000;
const DM_PELSHEIGHT = 0x100000;
const DM_DISPLAYFREQUENCY = 0x400000;
const CDS_UPDATEREGISTRY = 1;
const CDS_TEST = 2;
const CDS_NORESET = 0x10000000;

/** The size a target asks for as the panel has it (before rotation), when it gives one. */
export function nativeSize(
  target: Pick<DisplayTarget, 'width' | 'height' | 'rotation'>
): { width: number; height: number } | undefined {
  if (target.width === undefined || target.height === undefined) return undefined;
  const turned = target.rotation === 90 || target.rotation === 270;
  return turned
    ? { width: target.height, height: target.width }
    : { width: target.width, height: target.height };
}

/** True when the target asks for a size or refresh rate the monitor does not have now. */
export function modeDiffers(target: DisplayTarget, now: DisplayInfo): boolean {
  const size =
    target.width !== undefined &&
    target.height !== undefined &&
    // Compared unrotated, so a pure rotation is not a mode change.
    Math.min(target.width, target.height) !== Math.min(now.width, now.height);
  const sizeLong =
    target.width !== undefined &&
    target.height !== undefined &&
    Math.max(target.width, target.height) !== Math.max(now.width, now.height);
  const rate =
    target.refreshHz !== undefined && Math.abs((now.refreshHz ?? 0) - target.refreshHz) >= 0.5;
  return size || sizeLong || rate;
}

/** True when every enabled monitor of `targets` has the size and refresh rate asked for. */
function modesAsWanted(targets: Map<string, DisplayTarget>): boolean {
  return readLayout().displays.every((now) => {
    const target = targets.get(now.id);
    return !target?.enabled || !now.enabled || !modeDiffers(target, now);
  });
}

/**
 * Sets the size and refresh rate of enabled monitors that should have another one, each
 * tested first, through GDI: the fallback for when Windows does not take the new modes as
 * part of the layout (arrange with modesFrom). Every monitor's new mode is written
 * without resetting the displays (CDS_NORESET) and all of them are then applied by one
 * reset, so several monitors changing mode is one change, not one per monitor. Returns
 * how many monitors changed.
 */
function changeModes(targets: Map<string, DisplayTarget>): number {
  let changed = 0;
  for (const now of readLayout().displays) {
    const target = targets.get(now.id);
    if (!target?.enabled || !now.enabled || !now.gdiName || !modeDiffers(target, now)) continue;
    // GDI takes the size as the desktop sees it now (turned when the monitor is).
    const nowSideways = now.rotation === 90 || now.rotation === 270;
    const wantSideways = target.rotation === 90 || target.rotation === 270;
    let width = target.width ?? now.width;
    let height = target.height ?? now.height;
    if (target.width !== undefined && nowSideways !== wantSideways)
      [width, height] = [height, width];
    const hz = Math.round(target.refreshHz ?? now.refreshHz ?? 60);
    const devMode = Buffer.alloc(DEVMODE_SIZE);
    devMode.writeUInt16LE(DEVMODE_SIZE, DM_SIZE);
    devMode.writeUInt32LE(DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY, DM_FIELDS);
    devMode.writeUInt32LE(width, DM_WIDTH);
    devMode.writeUInt32LE(height, DM_HEIGHT);
    devMode.writeUInt32LE(hz, DM_FREQUENCY);
    const what = `${now.name || now.id} ${width}x${height} at ${hz} Hz`;
    const tested = ChangeDisplaySettingsExW(now.gdiName, devMode, 0, CDS_TEST, null);
    if (tested !== 0) throw new Error(`Windows does not accept ${what} (${tested})`);
    const status = ChangeDisplaySettingsExW(
      now.gdiName,
      devMode,
      0,
      CDS_UPDATEREGISTRY | CDS_NORESET,
      null
    );
    if (status !== 0) throw new Error(`Could not set ${what} (${status})`);
    changed++;
  }
  if (changed > 0) {
    // One reset applies everything written above.
    const status = ChangeDisplaySettingsExW(null, null, 0, 0, null);
    if (status !== 0) throw new Error(`Could not apply the new display modes (${status})`);
  }
  return changed;
}

export class WindowsDisplayProvider implements DisplayProvider {
  private undo: RawConfig[] = [];
  /**
   * How many times the last apply() changed the display configuration (SetDisplayConfig
   * applies plus GDI mode resets; 1 = one transaction). For the rig smoke test.
   */
  lastApplyCalls = 0;
  /** Why the last apply() could not be done in one call, when it could not. */
  lastAtomicFailure: string | undefined;

  async read(): Promise<Result<DisplayLayout>> {
    try {
      return ok(readLayout());
    } catch (e) {
      return err('display.read', 'Could not read the monitor configuration.', String(e));
    }
  }

  async apply(targets: DisplayTarget[]): Promise<Result<DisplayApplyOutcome>> {
    let captured: RawConfig;
    let previous: DisplayLayout;
    try {
      captured = query(QDC_ONLY_ACTIVE_PATHS);
      previous = readLayout();
    } catch (e) {
      return err('display.read', 'Could not capture the current monitor configuration.', String(e));
    }
    const known = new Map(previous.displays.map((d) => [d.id, d]));
    const wanted = new Map<string, DisplayTarget>();
    for (const t of targets) {
      const id = t.id.toLowerCase();
      if (!known.has(id)) {
        return err('display.missing', `Monitor is not connected: ${t.name || t.id}`);
      }
      wanted.set(id, { ...t, id });
    }
    const stillOn = previous.displays.filter(
      (d) => (wanted.get(d.id)?.enabled ?? d.enabled) === true
    );
    if (stillOn.length === 0) {
      return err('display.none', 'The layout would turn every monitor off.');
    }
    this.lastApplyCalls = 0;
    this.lastAtomicFailure = undefined;
    try {
      const toEnable = new Set(
        [...wanted.values()].filter((t) => t.enabled && !known.get(t.id)!.enabled).map((t) => t.id)
      );
      const modeChanges = [...wanted.values()].some((t) => {
        const now = known.get(t.id)!;
        return t.enabled && now.enabled && modeDiffers(t, now);
      });
      // Turning monitors on is part of the same call when their size is known. Otherwise,
      // or when Windows refuses that, Windows turns them on first and they are arranged after.
      const combined = toEnable.size > 0 ? configWithEnabled(wanted, toEnable) : undefined;
      if (toEnable.size > 0 && !combined) {
        this.lastAtomicFailure = 'no combined configuration (a size is missing or no free path)';
      }
      // First choice: everything in one SetDisplayConfig call, new sizes and refresh rates
      // included. It counts only when the monitors then really have those modes.
      let done = false;
      if (toEnable.size === 0 || combined) {
        try {
          arrange(wanted, combined, modeChanges ? known : undefined);
          this.lastApplyCalls++;
          done = !modeChanges || modesAsWanted(wanted);
          if (!done) {
            this.lastAtomicFailure =
              'Windows took the layout but kept another size or refresh rate; set separately';
          }
        } catch (e) {
          // Nothing was applied (the call validates first). Without a monitor to turn on
          // and without a mode change there is no other way to do it: report the failure.
          if (toEnable.size === 0 && !modeChanges) throw e;
          this.lastAtomicFailure = String(e);
        }
      }
      if (!done) {
        // In steps: monitors on (Windows picks their modes), then every new mode in one
        // reset, then the arrangement, which is given for the new sizes.
        const stillOff = [...toEnable].filter(
          (id) => !readLayout().displays.find((d) => d.id === id)?.enabled
        );
        if (stillOff.length > 0) {
          enableTargets(new Set(stillOff));
          this.lastApplyCalls++;
        }
        if (changeModes(wanted) > 0) this.lastApplyCalls++;
        arrange(wanted);
        this.lastApplyCalls++;
      }
      this.undo.push(captured);
      return ok({ previous, current: readLayout() });
    } catch (e) {
      // Put back exactly what was there before reporting the failure.
      const restored = this.restore(captured);
      return err(
        'display.apply',
        'Could not apply the monitor layout.',
        `${String(e)}${restored === 0 ? ' (previous layout restored)' : ` (restore failed with ${restored})`}`
      );
    }
  }

  canRevert(): boolean {
    return this.undo.length > 0;
  }

  async revert(): Promise<Result<DisplayLayout>> {
    const captured = this.undo.pop();
    if (!captured)
      return err('display.norevert', 'There is no earlier monitor layout to go back to.');
    const status = this.restore(captured);
    if (status !== 0) {
      this.undo.push(captured);
      return err(
        'display.revert',
        'Could not restore the earlier monitor layout.',
        `SetDisplayConfig ${status}`
      );
    }
    return this.read();
  }

  private restore(captured: RawConfig): number {
    const flags = SDC_APPLY | SDC_USE_SUPPLIED_DISPLAY_CONFIG | SDC_SAVE_TO_DATABASE;
    const exact = setConfig(captured, flags);
    return exact === 0 ? 0 : setConfig(captured, flags | SDC_ALLOW_CHANGES);
  }
}
