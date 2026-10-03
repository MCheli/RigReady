/**
 * What `npm run rig:record` copies from the machine besides the provider snapshots:
 * which files, and which registry keys. Kept as data so it can be reviewed in one place.
 *
 * Never listed here, on purpose: %APPDATA%\SimAppPro\config.json (account credentials),
 * DCS Config\network.vault and steam_authdata.bin, browser-profile folders, images and
 * program binaries.
 */

export type RecordRoot =
  | 'savedGames'
  | 'documents'
  | 'appData'
  | 'localAppData'
  | 'programFiles'
  | 'programFilesX86'
  | 'steamLibrary';

export interface FileSource {
  root: RecordRoot;
  /** Folder below the root, with backslashes. */
  dir: string;
  /** Glob patterns relative to dir (see src/core/files/glob.ts). */
  include: string[];
  exclude?: string[];
  /** Skip files larger than this many bytes (default 2 MB). */
  maxBytes?: number;
}

/** Steam app ids of the sims RigReady has game modules for (or will). */
export const SIM_APP_IDS: Record<string, string> = {
  '223750': 'DCS World',
  '266410': 'iRacing',
  '2399420': 'Le Mans Ultimate',
  '284160': 'BeamNG.drive',
  '2537590': 'Microsoft Flight Simulator 2024',
  '244210': 'Assetto Corsa',
  '3058630': 'Assetto Corsa EVO',
  '3917090': 'Assetto Corsa Rally',
};

const DCS = 'steamapps\\common\\DCSWorld';
const LMU = 'steamapps\\common\\Le Mans Ultimate';

export const FILE_SOURCES: FileSource[] = [
  // ---- DCS, per user ----
  {
    root: 'savedGames',
    dir: 'DCS\\Config',
    include: ['Input/**', 'MonitorSetup/**', 'options.lua', 'appSettings.lua', 'lang.cfg'],
  },
  {
    root: 'savedGames',
    dir: 'DCS\\Scripts',
    include: ['Export.lua', 'wwt/**', 'DCS-BIOS/BIOS.lua', 'DCS-BIOS/BIOSConfig.lua'],
  },
  { root: 'savedGames', dir: 'DCS\\Kneeboard', include: ['**/*.lua', '**/*.txt'] },
  // ---- DCS, install ----
  { root: 'steamLibrary', dir: `${DCS}\\Config\\MonitorSetup`, include: ['**'] },
  { root: 'steamLibrary', dir: `${DCS}\\Config\\Input`, include: ['**/*.lua'] },
  { root: 'steamLibrary', dir: `${DCS}\\Scripts\\Input`, include: ['**/*.lua'] },
  { root: 'steamLibrary', dir: `${DCS}\\Mods\\aircraft\\FA-18C\\Input`, include: ['**/*.lua'] },
  { root: 'steamLibrary', dir: `${DCS}\\Mods\\aircraft\\Uh-1H\\Input`, include: ['**/*.lua'] },
  { root: 'steamLibrary', dir: `${DCS}\\Mods\\aircraft`, include: ['*/entry.lua'] },
  // The input defaults dofile() these to get the cockpit device and command numbers.
  {
    root: 'steamLibrary',
    dir: `${DCS}\\Mods\\aircraft\\FA-18C\\Cockpit\\Scripts`,
    include: ['devices.lua', 'command_defs.lua'],
  },
  {
    root: 'steamLibrary',
    dir: `${DCS}\\Mods\\aircraft\\Uh-1H\\Cockpit\\Scripts`,
    include: ['devices.lua', 'command_defs.lua'],
  },
  { root: 'steamLibrary', dir: DCS, include: ['autoupdate.cfg', 'dcs_variant.txt', '_DCS_Steam'] },
  // ---- SimAppPro: the MFD plan only ----
  {
    root: 'appData',
    dir: 'SimAppPro\\GameExtendDisplay\\MFD',
    include: ['DCS_config.json'],
  },
  // ---- iRacing ----
  {
    root: 'documents',
    dir: 'iRacing',
    include: [
      'app.ini',
      'core.ini',
      'controls.cfg',
      'joyCalib.yaml',
      'camera.ini',
      'rendererDX11Monitor.ini',
    ],
  },
  {
    root: 'programFilesX86',
    dir: 'iRacing',
    include: ['version_system.txt', 'updater/version.txt'],
  },
  // ---- Le Mans Ultimate ----
  {
    root: 'steamLibrary',
    dir: `${LMU}\\UserData`,
    include: ['player/*.json', 'Controller/**/*.json', 'Config_DX11.ini'],
  },
  // ---- BeamNG.drive ----
  { root: 'localAppData', dir: 'BeamNG', include: ['BeamNG.drive.ini'] },
  {
    root: 'localAppData',
    dir: 'BeamNG\\BeamNG.drive\\current\\settings',
    include: ['inputmaps/**', 'settings.json'],
  },
  {
    root: 'steamLibrary',
    dir: 'steamapps\\common\\BeamNG.drive',
    include: ['startup.ini', 'integrity.json'],
    maxBytes: 64 * 1024,
  },
  // ---- Assetto Corsa, MSFS 2024 ----
  { root: 'documents', dir: 'Assetto Corsa\\cfg', include: ['controls.ini', 'video.ini'] },
  {
    root: 'appData',
    dir: 'Microsoft Flight Simulator 2024',
    include: ['UserCfg.opt', 'FlightSimulator2024.CFG'],
  },
  // ---- Fanatec ----
  { root: 'appData', dir: 'com.example\\Fanatec', include: ['shared_preferences.json'] },
  {
    root: 'programFiles',
    dir: 'Fanatec\\FanatecService\\Service\\xml',
    include: ['Configuration.xml'],
  },
  { root: 'programFiles', dir: 'Fanatec\\Fanatec Wheel\\fw', include: ['versions.xml'] },
  // ---- TrackIR ----
  { root: 'appData', dir: 'NaturalPoint\\TrackIR 5', include: ['ProfileMap.dat'] },
];

/**
 * Programs whose presence game modules and checks test with files.exists(). They are
 * recorded as EMPTY files: the fixture carries no binaries.
 */
export const PLACEHOLDER_FILES: { root: RecordRoot; path: string }[] = [
  { root: 'steamLibrary', path: `${DCS}\\bin\\DCS.exe` },
  { root: 'steamLibrary', path: `${DCS}\\bin-mt\\DCS.exe` },
  { root: 'steamLibrary', path: `${LMU}\\Le Mans Ultimate.exe` },
  { root: 'steamLibrary', path: 'steamapps\\common\\BeamNG.drive\\BeamNG.drive.exe' },
  { root: 'steamLibrary', path: 'steamapps\\common\\assettocorsa\\acs.exe' },
  { root: 'steamLibrary', path: 'steamapps\\common\\assettocorsa\\AssettoCorsa.exe' },
  { root: 'steamLibrary', path: 'steam.exe' },
  { root: 'programFilesX86', path: 'iRacing\\ui\\iRacingUI.exe' },
  { root: 'programFilesX86', path: 'iRacing\\iRacingSim64DX11.exe' },
  { root: 'programFilesX86', path: 'NaturalPoint\\TrackIR5\\TrackIR5.exe' },
  { root: 'programFiles', path: 'Nefarius Software Solutions\\HidHide\\x64\\HidHideCLI.exe' },
  { root: 'programFiles', path: 'Fanatec\\FanatecUI\\UI\\Fanatec.exe' },
  { root: 'programFiles', path: 'Fanatec\\FanatecService\\Service\\FanatecService.exe' },
  { root: 'programFiles', path: 'Elgato\\StreamDeck\\StreamDeck.exe' },
  { root: 'localAppData', path: 'SimAppPro\\SimAppPro.exe' },
];

export interface RegistrySource {
  hive: 'HKCU' | 'HKLM';
  key: string;
  /** How many levels of sub-keys to follow. */
  depth: number;
  /** Only these value names are kept (case-insensitive). Without it every value is kept. */
  values?: string[];
}

const MEDIA = 'System\\CurrentControlSet\\Control\\MediaProperties\\PrivateProperties';

export const REGISTRY_SOURCES: RegistrySource[] = [
  // DirectInput: instance GUIDs per controller model, and the product names games use.
  { hive: 'HKCU', key: `${MEDIA}\\DirectInput`, depth: 4 },
  { hive: 'HKCU', key: `${MEDIA}\\Joystick\\OEM`, depth: 1, values: ['OEMName'] },
  { hive: 'HKLM', key: `${MEDIA}\\Joystick\\OEM`, depth: 1, values: ['OEMName'] },
  {
    hive: 'HKCU',
    key: 'System\\CurrentControlSet\\Control\\MediaResources\\Joystick\\DINPUT.DLL\\CurrentJoystickSettings',
    depth: 0,
  },
  // Steam: where it is. Account names and the like are deliberately not kept.
  { hive: 'HKCU', key: 'Software\\Valve\\Steam', depth: 0, values: ['SteamPath', 'SteamExe'] },
  { hive: 'HKLM', key: 'SOFTWARE\\WOW6432Node\\Valve\\Steam', depth: 0, values: ['InstallPath'] },
  // DCS standalone (absent for the Steam edition, recorded when present).
  { hive: 'HKCU', key: 'Software\\Eagle Dynamics', depth: 3 },
  // Fanatec: per-user service settings and the driver's cache of the last-seen hardware.
  { hive: 'HKCU', key: 'Software\\Endor\\FanatecService', depth: 4 },
  { hive: 'HKLM', key: 'SOFTWARE\\WOW6432Node\\Fanatec Endor AG', depth: 3 },
  // iRacing installer key.
  {
    hive: 'HKLM',
    key: 'SOFTWARE\\WOW6432Node\\iRacing.com Motorsport Simulations',
    depth: 3,
  },
];

/** Where Windows lists installed programs. Entries are kept when UNINSTALL_FILTER matches. */
export const UNINSTALL_ROOTS: { hive: 'HKCU' | 'HKLM'; key: string }[] = [
  { hive: 'HKLM', key: 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
  { hive: 'HKLM', key: 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
  { hive: 'HKCU', key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' },
];

export const UNINSTALL_VALUES = [
  'DisplayName',
  'DisplayVersion',
  'Publisher',
  'InstallLocation',
  'DisplayIcon',
];

/** Sims and helper apps, by display name. */
export const UNINSTALL_FILTER =
  /DCS World|iRacing|Le Mans Ultimate|BeamNG|Flight Simulator|Assetto Corsa|Tacview|SimAppPro|Stream Deck|TrackIR|Fanatec|HidHide|ViGEm|^Steam$|Virpil|VPC |Thrustmaster|WINWING|SimHub|CrewChief|Open Kneeboard|OpenKneeboard|SRS|VAICOM|VoiceAttack|Helios|DCS-BIOS|Mosquitto/i;

/** True for an uninstall entry worth recording: a known program, or a Steam entry of a known sim. */
export function wantUninstallEntry(keyName: string, displayName: string): boolean {
  const steam = /^Steam App (\d+)$/.exec(keyName);
  if (steam) return SIM_APP_IDS[steam[1]!] !== undefined;
  return UNINSTALL_FILTER.test(displayName);
}

/**
 * Keeps the launch lines and the controller lines of dcs.log (the "full id" of every
 * device DCS created) and drops the rest, which is long and describes the whole PC.
 */
export function filterDcsLog(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept = lines.filter(
    (line, index) =>
      index < 3 ||
      /INPUT \(Main\): created \[/.test(line) ||
      /Command line:/.test(line) ||
      /DCS\/\d+\.\d+/.test(line)
  );
  return kept.join('\r\n') + '\r\n';
}

/**
 * A Stream Deck manifest with every action's settings emptied: the structure (pages,
 * positions, plugin and action ids, titles) stays, anything the user typed into an
 * action (text to paste, URLs, tokens) does not.
 */
export function redactStreamDeckManifest(text: string): string {
  const scrub = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, inner]) =>
          key === 'Settings' ? [key, {}] : [key, scrub(inner)]
        )
      );
    }
    return value;
  };
  return JSON.stringify(scrub(JSON.parse(text)), null, 2) + '\n';
}

/** libraryfolders.vdf with each library's "apps" list cut down to the recorded sims. */
export function filterLibraryFolders(text: string): string {
  return text
    .replace(/^(\s*)"(\d+)"(\s+)"(\d+)"\s*$/gm, (line, _i, appId: string) =>
      SIM_APP_IDS[appId] !== undefined ? line : '\u0000'
    )
    .replace(/\u0000\r?\n?/g, '');
}
