import { BackupFileStore } from '../src/core/files/fileStore';

/**
 * Loaded before every unit test file (vitest `setupFiles`): any test in which RigReady
 * changes a file below Program Files fails, whatever feature did it. RigReady runs
 * without administrator rights, and Windows protects those folders; a feature that
 * needs a file there must not be offered (PLAT-007).
 *
 * The one exception is a Steam library: Steam makes `steamapps` writable for every user
 * precisely so games can keep files there (Le Mans Ultimate keeps its settings in its
 * install folder), so a change below `steamapps` is an ordinary user-folder write.
 */
const PROGRAM_FILES = /[\\/]Program Files(?: \(x86\))?[\\/]/i;
const STEAM_LIBRARY = /[\\/]steamapps[\\/]/i;

export function isProtectedInstallPath(file: string): boolean {
  return PROGRAM_FILES.test(file) && !STEAM_LIBRARY.test(file);
}

const state = globalThis as unknown as { __rigreadyProgramFilesGuard?: { refused: string[] } };

if (!state.__rigreadyProgramFilesGuard) {
  const guard = { refused: [] as string[] };
  state.__rigreadyProgramFilesGuard = guard;
  const proto = BackupFileStore.prototype as unknown as Record<
    string,
    (this: BackupFileStore, file: string, ...rest: unknown[]) => Promise<unknown>
  >;
  // Every change (write, copy, move, remove, copyTree, extractZip, undo) ends in change();
  // folders are made through mkdir().
  for (const method of ['change', 'mkdir']) {
    const original = proto[method]!;
    proto[method] = function (file, ...rest) {
      if (isProtectedInstallPath(file)) {
        guard.refused.push(file);
        return Promise.reject(
          new Error(`Test guard: RigReady must not change files below Program Files (${file})`)
        );
      }
      return original.call(this, file, ...rest);
    };
  }
}

/** The paths the guard refused in this test file so far. */
export const refusedProgramFilesWrites = (): string[] =>
  state.__rigreadyProgramFilesGuard?.refused ?? [];
