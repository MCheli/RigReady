import type { DisplayApplyOutcome, DisplayProvider } from '../../core/ports';
import { err, ok, type Result } from '../../core/result';
import type { DisplayInfo, DisplayLayout, DisplayTarget, Rotation } from '../../shared/models';
import {
  DisplayConfigGetDeviceInfo,
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
const P_TGT_AVAILABLE = 60;
const P_FLAGS = 68;
// DISPLAYCONFIG_MODE_INFO offsets
const M_TYPE = 0;
const M_SRC_WIDTH = 16;
const M_SRC_HEIGHT = 20;
const M_SRC_X = 28;
const M_SRC_Y = 32;

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
  };
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
    const gdi = sourceName(active.paths, o);
    if (gdi) info.gdiName = gdi;
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

/** Rotation, position, primary and disable for monitors that are currently active. */
function arrangeActive(targets: Map<string, DisplayTarget>): void {
  const config = query(QDC_ONLY_ACTIVE_PATHS);
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
    // Source modes are stored unrotated; targets give the desktop (rotated) size.
    let width = config.modes.readUInt32LE(m + M_SRC_WIDTH);
    let height = config.modes.readUInt32LE(m + M_SRC_HEIGHT);
    if (target.width !== undefined && target.height !== undefined) {
      const sideways = target.rotation === 90 || target.rotation === 270;
      const wantWidth = sideways ? target.height : target.width;
      const wantHeight = sideways ? target.width : target.height;
      if (wantWidth !== width || wantHeight !== height) {
        // A different resolution: let Windows pick a matching target mode.
        config.paths.writeUInt32LE(IDX_INVALID, o + P_TGT_MODE);
        width = wantWidth;
        height = wantHeight;
      }
    }
    config.paths.writeUInt32LE(ROTATION_TO_RAW[target.rotation], o + P_TGT_ROTATION);
    config.modes.writeUInt32LE(width, m + M_SRC_WIDTH);
    config.modes.writeUInt32LE(height, m + M_SRC_HEIGHT);
    config.modes.writeInt32LE(target.x, m + M_SRC_X);
    config.modes.writeInt32LE(target.y, m + M_SRC_Y);
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

export class WindowsDisplayProvider implements DisplayProvider {
  private undo: RawConfig[] = [];

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
    try {
      const toEnable = new Set(
        [...wanted.values()].filter((t) => t.enabled && !known.get(t.id)!.enabled).map((t) => t.id)
      );
      if (toEnable.size > 0) enableTargets(toEnable);
      arrangeActive(wanted);
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
