import path from 'node:path';
import type { Ports, Registry } from '../../../core/ports';
import { ok, type Result } from '../../../core/result';
import type { DeviceInfo, ProcessInfo } from '../../../shared/models';
import type { StreamDeckDevice, StreamDeckStatus } from './model';

export const ELGATO_VENDOR_ID = '0FD9';
export const PROCESS_NAME = 'StreamDeck.exe';
export const DOWNLOAD_URL = 'https://www.elgato.com/downloads';

/** Stream Deck models by USB product id (Elgato's other gear shares the vendor id). */
const MODELS: Record<string, string> = {
  '0060': 'Stream Deck',
  '0063': 'Stream Deck Mini',
  '006C': 'Stream Deck XL',
  '006D': 'Stream Deck',
  '0080': 'Stream Deck MK.2',
  '0084': 'Stream Deck +',
  '0086': 'Stream Deck Pedal',
  '008F': 'Stream Deck XL',
  '0090': 'Stream Deck Mini',
  '009A': 'Stream Deck Neo',
};

export function modelName(productId: string): string | undefined {
  return MODELS[productId.toUpperCase()];
}

export function isStreamDeck(device: Pick<DeviceInfo, 'vendorId' | 'productId' | 'name'>): boolean {
  if (device.vendorId.toUpperCase() !== ELGATO_VENDOR_ID) return false;
  return modelName(device.productId) !== undefined || /stream\s*deck/i.test(device.name);
}

export function streamDecks(devices: DeviceInfo[]): StreamDeckDevice[] {
  return devices.filter(isStreamDeck).map((d) => ({
    name: d.name || modelName(d.productId) || 'Stream Deck',
    vendorId: d.vendorId,
    productId: d.productId,
    ...(d.serial ? { serial: d.serial } : {}),
  }));
}

export interface StreamDeckPaths {
  /** %APPDATA%\Elgato\StreamDeck */
  appDir: string;
  profilesDir: string;
  profilesV3: boolean;
  pluginsDir: string;
  /** Where the Stream Deck app keeps its own automatic backups. */
  elgatoBackupsDir: string;
  /** RigReady's own backups. */
  backupsDir: string;
}

export async function streamDeckPaths(ports: Ports): Promise<StreamDeckPaths> {
  const appDir = path.join(ports.folders.appData(), 'Elgato', 'StreamDeck');
  const v3 = path.join(appDir, 'ProfilesV3');
  const v2 = path.join(appDir, 'ProfilesV2');
  // Stream Deck 6 used ProfilesV2; 6.5 and later convert it to ProfilesV3.
  const profilesV3 = (await ports.files.exists(v3)) || !(await ports.files.exists(v2));
  return {
    appDir,
    profilesDir: profilesV3 ? v3 : v2,
    profilesV3,
    pluginsDir: path.join(appDir, 'Plugins'),
    elgatoBackupsDir: path.join(appDir, 'BackupV3'),
    backupsDir: path.join(ports.folders.dataRoot(), 'stream-deck', 'backups'),
  };
}

const UNINSTALL_KEYS: { hive: 'HKLM' | 'HKCU'; key: string }[] = [
  { hive: 'HKLM', key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
  { hive: 'HKLM', key: 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
  { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
];

export interface UninstallEntry {
  displayName: string;
  version?: string;
  installLocation?: string;
}

/** The first Windows "Apps" entry whose display name matches. */
export async function findUninstallEntry(
  registry: Registry,
  name: RegExp
): Promise<Result<UninstallEntry | undefined>> {
  for (const { hive, key } of UNINSTALL_KEYS) {
    const keys = await registry.listKeys(hive, key);
    if (!keys.ok) return keys;
    for (const sub of keys.value) {
      const values = await registry.listValues(hive, `${key}\\${sub}`);
      if (!values.ok) return values;
      const display = values.value['DisplayName'];
      if (display?.type !== 'string' || !name.test(display.value)) continue;
      const version = values.value['DisplayVersion'];
      const location = values.value['InstallLocation'];
      return ok({
        displayName: display.value,
        ...(version?.type === 'string' && version.value ? { version: version.value } : {}),
        ...(location?.type === 'string' && location.value
          ? { installLocation: location.value }
          : {}),
      });
    }
  }
  return ok(undefined);
}

export async function findExe(ports: Ports, entry?: UninstallEntry): Promise<string | undefined> {
  const candidates = [
    ...(entry?.installLocation ? [path.join(entry.installLocation, 'StreamDeck.exe')] : []),
    path.join(ports.folders.programFiles(), 'Elgato', 'StreamDeck', 'StreamDeck.exe'),
  ];
  for (const candidate of candidates) {
    if (await ports.files.exists(candidate)) return candidate;
  }
  return undefined;
}

export const isAppProcess = (p: ProcessInfo): boolean =>
  p.name.toLowerCase() === PROCESS_NAME.toLowerCase();

/** Install, version, running state and connected hardware. Every part degrades on its own. */
export async function detectStreamDeck(ports: Ports): Promise<Result<StreamDeckStatus>> {
  const paths = await streamDeckPaths(ports);
  const entry = await findUninstallEntry(ports.registry, /^(Elgato )?Stream Deck$/i);
  const uninstall = entry.ok ? entry.value : undefined;
  const exePath = await findExe(ports, uninstall);
  const processes = await ports.processes.list();
  if (!processes.ok) return processes;
  const devices = await ports.devices.list();
  if (!devices.ok) return devices;
  return ok({
    installed: exePath !== undefined,
    ...(exePath ? { exePath } : {}),
    ...(exePath && uninstall?.version ? { version: uninstall.version } : {}),
    running: processes.value.some(isAppProcess),
    devices: streamDecks(devices.value),
    profilesFolder: paths.profilesDir,
    profilesV3: paths.profilesV3,
    pluginsFolder: paths.pluginsDir,
  });
}
