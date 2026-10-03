import type { Ports } from '../../../core/ports';
import type { DeviceInfo } from '../../../shared/models';

/**
 * HidHide (Nefarius) can hide a device from every program that is not on its allow
 * list. RigReady only reads its state, through HidHideCLI.exe with an argument array;
 * every query ends with --cancel because the CLI saves its configuration on exit otherwise.
 * Reading the HidHide registry key needs admin rights, so the CLI is the only way.
 */

export interface HidHideGamingDevice {
  /** HID\VID_...&PID_...\... */
  deviceInstancePath: string;
  /** USB\VID_...&PID_...\... of the physical device. */
  baseContainerDeviceInstancePath: string;
}

export type HidHideInfo =
  | { installed: false }
  | {
      installed: true;
      cli: string;
      /** Set when the CLI is installed but could not be asked. */
      error?: string;
      cloak: boolean;
      inverse: boolean;
      /** Device instance paths on the hidden list. */
      hidden: string[];
      /** Programs on the allow list (or, in inverse mode, the block list). */
      apps: string[];
      gaming: HidHideGamingDevice[];
    };

export const STATE_ARGS = ['--cloak-state', '--inv-state', '--dev-list', '--app-list', '--cancel'];
export const GAMING_ARGS = ['--dev-gaming', '--cancel'];

const UNINSTALL = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

/** HidHideCLI.exe from HidHide's uninstall entry, or the default install folder. */
export async function findHidHideCli(
  ports: Pick<Ports, 'registry' | 'files' | 'folders'>
): Promise<string | undefined> {
  const keys = await ports.registry.listKeys('HKLM', UNINSTALL);
  const candidates: string[] = [];
  if (keys.ok) {
    for (const key of keys.value) {
      const name = await ports.registry.getValue('HKLM', `${UNINSTALL}\\${key}`, 'DisplayName');
      if (!name.ok || name.value?.type !== 'string' || name.value.value.trim() !== 'HidHide') {
        continue;
      }
      const location = await ports.registry.getValue(
        'HKLM',
        `${UNINSTALL}\\${key}`,
        'InstallLocation'
      );
      if (location.ok && location.value?.type === 'string' && location.value.value.trim()) {
        candidates.push(
          `${location.value.value.trim().replace(/[\\/]+$/, '')}\\x64\\HidHideCLI.exe`
        );
      }
    }
  }
  candidates.push(
    `${ports.folders.programFiles()}\\Nefarius Software Solutions\\HidHide\\x64\\HidHideCLI.exe`
  );
  for (const candidate of candidates) {
    if (await ports.files.exists(candidate)) return candidate;
  }
  return undefined;
}

/** Strips one pair of quotes. */
const unquote = (value: string): string => value.trim().replace(/^"(.*)"$/, '$1');

/** Parses the command-form lines `--cloak-on`, `--inv-off`, `--dev-hide "<path>"`, `--app-reg "<exe>"`. */
export function parseHidHideState(stdout: string): {
  cloak: boolean;
  inverse: boolean;
  hidden: string[];
  apps: string[];
} {
  const state = { cloak: false, inverse: false, hidden: [] as string[], apps: [] as string[] };
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '--cloak-on') state.cloak = true;
    else if (line === '--cloak-off') state.cloak = false;
    else if (line === '--inv-on') state.inverse = true;
    else if (line === '--inv-off') state.inverse = false;
    else if (line.startsWith('--dev-hide ')) state.hidden.push(unquote(line.slice(11)));
    else if (line.startsWith('--app-reg ')) state.apps.push(unquote(line.slice(10)));
  }
  return state;
}

/** Parses `--dev-gaming` JSON: groups of HID nodes with their USB parent. */
export function parseGaming(stdout: string): HidHideGamingDevice[] {
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start < 0 || end < start) return [];
  try {
    const groups = JSON.parse(stdout.slice(start, end + 1)) as unknown;
    if (!Array.isArray(groups)) return [];
    const out: HidHideGamingDevice[] = [];
    for (const group of groups) {
      const devices = (group as { devices?: unknown }).devices;
      if (!Array.isArray(devices)) continue;
      for (const d of devices) {
        const entry = d as Record<string, unknown>;
        if (typeof entry['deviceInstancePath'] !== 'string') continue;
        out.push({
          deviceInstancePath: entry['deviceInstancePath'],
          baseContainerDeviceInstancePath:
            typeof entry['baseContainerDeviceInstancePath'] === 'string'
              ? entry['baseContainerDeviceInstancePath']
              : '',
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function readHidHide(ports: Ports): Promise<HidHideInfo> {
  const cli = await findHidHideCli(ports);
  if (!cli) return { installed: false };
  const empty = { cloak: false, inverse: false, hidden: [], apps: [], gaming: [] };
  const state = await ports.shell.run(cli, STATE_ARGS, { timeoutMs: 5000 });
  if (!state.ok) {
    // The uninstall entry is there but the program is not: treat as not installed.
    if (state.error.code === 'shell.spawn') return { installed: false };
    return { installed: true, cli, error: state.error.message, ...empty };
  }
  if (state.value.code !== 0) {
    return {
      installed: true,
      cli,
      error: `HidHideCLI exited with code ${state.value.code}.`,
      ...empty,
    };
  }
  const parsed = parseHidHideState(state.value.stdout);
  let gaming: HidHideGamingDevice[] = [];
  if (parsed.hidden.length > 0) {
    const listed = await ports.shell.run(cli, GAMING_ARGS, { timeoutMs: 5000 });
    if (listed.ok && listed.value.code === 0) gaming = parseGaming(listed.value.stdout);
  }
  return { installed: true, cli, ...parsed, gaming };
}

/** Short-lived cache: one check run asks for every device at once. */
const cache = new WeakMap<Ports, { at: number; value: Promise<HidHideInfo> }>();
const CACHE_MS = 3000;

export function hidHideCached(ports: Ports): Promise<HidHideInfo> {
  const now = ports.clock.now().getTime();
  const hit = cache.get(ports);
  if (hit && now - hit.at < CACHE_MS && now >= hit.at) return hit.value;
  const value = readHidHide(ports);
  cache.set(ports, { at: now, value });
  return value;
}

const VID_PID = /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i;

/**
 * Instance ids (upper case) of the present USB devices that are on HidHide's hidden list.
 * A hidden HID node is traced to its USB device through the --dev-gaming list; failing
 * that, by its VID/PID when only one such device is present, or by the shared instance suffix.
 */
export function hiddenDeviceIds(info: HidHideInfo, devices: DeviceInfo[]): Set<string> {
  const out = new Set<string>();
  if (!info.installed || info.hidden.length === 0) return out;
  const parents = new Map(
    info.gaming.map((g) => [
      g.deviceInstancePath.toUpperCase(),
      g.baseContainerDeviceInstancePath.toUpperCase(),
    ])
  );
  const present = devices.filter((d) => !d.isHub);
  for (const raw of info.hidden) {
    const hidden = raw.toUpperCase();
    const parent = parents.get(hidden);
    const direct = present.find(
      (d) => d.instanceId.toUpperCase() === hidden || d.instanceId.toUpperCase() === parent
    );
    if (direct) {
      out.add(direct.instanceId.toUpperCase());
      continue;
    }
    const ids = VID_PID.exec(hidden);
    if (!ids) continue;
    const model = present.filter(
      (d) => d.vendorId === ids[1]!.toUpperCase() && d.productId === ids[2]!.toUpperCase()
    );
    const suffix = hidden.split('\\').pop() ?? '';
    const bySuffix = model.find((d) => d.instanceId.toUpperCase().split('\\').pop() === suffix);
    if (bySuffix) out.add(bySuffix.instanceId.toUpperCase());
    else if (model.length === 1) out.add(model[0]!.instanceId.toUpperCase());
  }
  return out;
}

const fileName = (exe: string): string => exe.split(/[\\/]/).pop()!.toLowerCase();

/** True when the program is on HidHide's list (full path, or file name when only that is known). */
export function onAppList(info: HidHideInfo, exe: string): boolean {
  if (!info.installed) return false;
  const wanted = exe.toLowerCase();
  const name = fileName(exe);
  return info.apps.some((app) => app.toLowerCase() === wanted || fileName(app) === name);
}

/**
 * Whether a program can see a device that is on the hidden list. Without cloaking nothing
 * is hidden. Normally only listed programs see hidden devices; inverse mode turns that round.
 */
export function canSeeHidden(info: HidHideInfo, exe: string | undefined): boolean | undefined {
  if (!info.installed || !info.cloak) return true;
  if (exe === undefined) return info.inverse ? undefined : false;
  const listed = onAppList(info, exe);
  return info.inverse ? !listed : listed;
}
