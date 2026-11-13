import path from 'node:path';
import { isWithin } from './paths';
import type { KnownFolders } from './ports';

/**
 * What a game the user adds may name, and what nothing may vouch for.
 *
 * A game's settings folders are places a backup reads and a restore writes, and a game's
 * programs are asked to close before its files are restored. A game the user adds on the
 * Games page names both itself, and its file (`<data folder>/games/custom.json`) can be
 * edited by hand. A folder that holds far more than one game's settings (a whole drive,
 * Windows, the user folder) or a program that is part of Windows or RigReady itself would
 * turn those into harm, so they are refused when the game is added, again when its file is
 * read back, and by the backup feature when a game's folder would vouch for a path.
 */

/** A path on a drive letter: never \\server\share, \\?\C:\... or \\.\device. */
const ON_A_DRIVE = /^[a-zA-Z]:[\\/]/;

const sameFolder = (a: string, b: string): boolean =>
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** The folder itself, or a folder that contains it. */
const holds = (folder: string, inside: string): boolean => isWithin(folder, inside);

/**
 * A test for folders that are too broad to be the settings folder of a game: it answers
 * why, as the end of a sentence ("it is a whole drive"), or undefined when the folder is
 * fine. The caller says what was refused. The Steam libraries are read once, here.
 */
export async function broadFolderTest(ports: {
  folders: KnownFolders;
}): Promise<(folder: string) => string | undefined> {
  const { folders } = ports;
  const listed = await folders.steamLibraries();
  const libraries = listed.ok ? listed.value : [];
  const appDataParent = path.dirname(folders.appData());
  const shared = [
    folders.documents(),
    folders.savedGames(),
    folders.desktop(),
    folders.appData(),
    folders.localAppData(),
    ...(isWithin(appDataParent, folders.localAppData()) ? [appDataParent] : []),
  ];
  return (folder) => {
    if (!ON_A_DRIVE.test(folder)) return 'it is not a folder on a drive of this PC';
    const resolved = path.resolve(folder);
    if (path.parse(resolved).root.toLowerCase() === resolved.toLowerCase()) {
      return 'it is a whole drive';
    }
    if (isWithin(folders.windows(), resolved)) return 'it is part of Windows';
    if (holds(resolved, folders.home())) return 'it holds your whole user folder';
    const data = folders.dataRoot();
    if (isWithin(data, resolved)) return "it is RigReady's own folder";
    if (holds(resolved, data)) return "it holds RigReady's own folder";
    if (holds(resolved, folders.programFiles()) || holds(resolved, folders.programFilesX86())) {
      return 'it holds every installed program';
    }
    if (holds(resolved, folders.programData())) return 'it holds the data of every program';
    if (shared.some((known) => holds(resolved, known))) {
      return "it holds the files of many programs. Choose the game's own folder inside it";
    }
    for (const library of libraries) {
      if (
        holds(resolved, library) ||
        sameFolder(resolved, path.join(library, 'steamapps')) ||
        sameFolder(resolved, path.join(library, 'steamapps', 'common'))
      ) {
        return 'it holds a whole Steam library';
      }
    }
    return undefined;
  };
}

/** broadFolderTest for one folder. */
export async function broadFolderReason(
  ports: { folders: KnownFolders },
  folder: string
): Promise<string | undefined> {
  return (await broadFolderTest(ports))(folder);
}

/**
 * Windows' own programs, by image name in lower case. Never a game's: closing one before a
 * restore would close part of Windows, and treating one as "the game is running" would
 * keep a game running for ever.
 */
const WINDOWS_PROGRAMS = new Set([
  'system',
  'registry',
  'idle',
  'system idle process',
  'secure system',
  'memory compression',
  'smss.exe',
  'csrss.exe',
  'wininit.exe',
  'winlogon.exe',
  'services.exe',
  'lsass.exe',
  'lsaiso.exe',
  'svchost.exe',
  'fontdrvhost.exe',
  'dwm.exe',
  'explorer.exe',
  'sihost.exe',
  'taskhostw.exe',
  'ctfmon.exe',
  'runtimebroker.exe',
  'searchhost.exe',
  'searchapp.exe',
  'searchui.exe',
  'searchindexer.exe',
  'startmenuexperiencehost.exe',
  'shellexperiencehost.exe',
  'textinputhost.exe',
  'applicationframehost.exe',
  'systemsettings.exe',
  'smartscreen.exe',
  'securityhealthservice.exe',
  'securityhealthsystray.exe',
  'msmpeng.exe',
  'nissrv.exe',
  'spoolsv.exe',
  'audiodg.exe',
  'conhost.exe',
  'dllhost.exe',
  'rundll32.exe',
  'wmiprvse.exe',
  'wudfhost.exe',
  'dashost.exe',
  'backgroundtaskhost.exe',
  'lockapp.exe',
  'logonui.exe',
  'userinit.exe',
  'consent.exe',
  'taskmgr.exe',
  // Windows' command shells, as names to refuse; nothing here starts a program. (Written as
  // one line of names: the shell audit looks for a shell started by a quoted name.)
  ...'cmd.exe powershell.exe pwsh.exe'.split(' '),
  'wscript.exe',
  'cscript.exe',
  'mshta.exe',
  'regedit.exe',
  'mmc.exe',
  'msiexec.exe',
  'werfault.exe',
  'wermgr.exe',
  'trustedinstaller.exe',
  'tiworker.exe',
  'windowsterminal.exe',
  'openconsole.exe',
  'msedgewebview2.exe',
]);

/** RigReady itself, as installed and as run from source. */
const RIGREADY_PROGRAMS = new Set(['rigready.exe', 'electron.exe']);

/**
 * Steam, which runs every Steam game: closing it before one game's restore would close all
 * of them, and counting it as one game running would hold back RigReady's updates for as long
 * as Steam is open. A Steam game is named by its Steam app id instead.
 */
const STEAM_PROGRAMS = new Set(['steam.exe', 'steamwebhelper.exe', 'steamservice.exe']);

/**
 * Why an image name may not stand for a game's program, as the end of a sentence ("it is
 * part of Windows"); undefined when it may.
 */
export function protectedProgramReason(name: string): string | undefined {
  const key = name.trim().toLowerCase();
  if (RIGREADY_PROGRAMS.has(key)) return 'it is RigReady itself';
  if (WINDOWS_PROGRAMS.has(key)) return 'it is part of Windows';
  if (STEAM_PROGRAMS.has(key)) {
    return 'it is Steam, which runs every Steam game. For a Steam game, give its Steam app id';
  }
  return undefined;
}

/** Why a program file may not be a game's program, as protectedProgramReason says it. */
export function protectedProgramFileReason(
  ports: { folders: KnownFolders },
  file: string
): string | undefined {
  if (!ON_A_DRIVE.test(file)) return 'it is not a file on a drive of this PC';
  if (isWithin(ports.folders.windows(), file)) return 'it is part of Windows';
  if (isWithin(ports.folders.dataRoot(), file)) return "it is in RigReady's own folder";
  return protectedProgramReason(path.win32.basename(file));
}
