import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import { broadFolderReason, protectedProgramFileReason } from '../../../core/guards';
import { err, ok, type Result } from '../../../core/result';
import type { UserGame, UserGameDraft, UserGameKind } from './customGames';

/**
 * The program and the settings folders of a game the user adds come only from the native
 * pickers. Main keeps what was picked and hands the window a ref to show and send back
 * ("pick-3"); the program and folders a game already has are "saved-0", "saved-1", ...
 * The window never sends a path, so nothing typed or forged reaches a game's definition.
 */

export interface Picked {
  picked: boolean;
  ref?: string;
  shown?: string;
  name?: string;
  process?: string;
}

/** Folder names that say nothing about the game; the game is named after the one above. */
const GENERIC = /^(bin|bin32|bin64|x64|x86|win32|win64|binaries|game|release|retail|exe)$/i;

/** A name to start from for a game whose program is `file`: its folder's, or the file's. */
export function nameFromProgram(file: string): string {
  let dir = path.win32.dirname(file);
  for (let i = 0; i < 3 && GENERIC.test(path.win32.basename(dir)); i++) {
    dir = path.win32.dirname(dir);
  }
  const folder = path.win32.basename(dir);
  const fromFolder = folder && !/^[a-zA-Z]:\\?$/.test(dir) && !GENERIC.test(folder);
  return (fromFolder ? folder : path.win32.basename(file).replace(/\.exe$/i, '')).slice(0, 60);
}

export class UserGamePicks {
  private readonly picks = new Map<string, { kind: 'program' | 'folder'; path: string }>();
  private next = 1;

  constructor(private readonly ctx: Pick<CheckContext, 'ports'>) {}

  private remember(kind: 'program' | 'folder', file: string): string {
    const ref = `pick-${this.next++}`;
    this.picks.set(ref, { kind, path: file });
    return ref;
  }

  async program(): Promise<Result<Picked>> {
    const picked = await this.ctx.ports.dialogs.open({
      title: 'Choose the program that starts the game',
      filters: [{ name: 'Programs', extensions: ['exe'] }],
    });
    if (!picked.ok) return picked;
    const file = picked.value[0];
    if (!file) return ok({ picked: false });
    const why = !/\.exe$/i.test(file)
      ? 'it is not a program file (.exe)'
      : protectedProgramFileReason(this.ctx.ports, file);
    if (why) return err('games.custom.program', `RigReady cannot use ${file}: ${why}.`);
    return ok({
      picked: true,
      ref: this.remember('program', file),
      shown: file,
      name: nameFromProgram(file),
      process: path.win32.basename(file),
    });
  }

  async folder(game: string | undefined): Promise<Result<Picked>> {
    const picked = await this.ctx.ports.dialogs.open({
      title: `Choose a folder where ${game?.trim() || 'the game'} keeps its settings`,
      directory: true,
    });
    if (!picked.ok) return picked;
    const folder = picked.value[0];
    if (!folder) return ok({ picked: false });
    const why = await broadFolderReason(this.ctx.ports, folder);
    if (why) {
      return err(
        'games.custom.folder',
        `RigReady cannot use ${folder}: ${why}.`,
        'Choose the folder where the game keeps its own settings, such as Documents\\Star Hauler.'
      );
    }
    return ok({ picked: true, ref: this.remember('folder', folder), shown: folder });
  }

  /** The draft the window described, with every ref turned back into what was picked. */
  resolve(
    input: {
      gameId?: string;
      name: string;
      kind: UserGameKind;
      program?: string;
      folders: string[];
      steamAppId?: string;
      processes: string[];
    },
    existing: UserGame | undefined
  ): Result<UserGameDraft> {
    const lookup = (ref: string, kind: 'program' | 'folder'): string | undefined => {
      const saved = /^saved-(\d+)$/.exec(ref);
      if (saved) {
        const index = Number(saved[1]);
        if (kind === 'program') return index === 0 ? existing?.program : undefined;
        return existing?.folders[index];
      }
      const pick = this.picks.get(ref);
      return pick?.kind === kind ? pick.path : undefined;
    };
    let program: string | undefined;
    if (input.program) {
      program = lookup(input.program, 'program');
      if (!program) {
        return err('games.custom.pick', 'Choose the program again: RigReady no longer has it.');
      }
    }
    const folders: string[] = [];
    for (const ref of input.folders) {
      const folder = lookup(ref, 'folder');
      if (!folder) {
        return err(
          'games.custom.pick',
          'Choose the settings folder again: RigReady no longer has it.'
        );
      }
      folders.push(folder);
    }
    return ok({
      ...(input.gameId ? { gameId: input.gameId } : {}),
      name: input.name,
      kind: input.kind,
      ...(program ? { program } : {}),
      folders,
      ...(input.steamAppId ? { steamAppId: input.steamAppId } : {}),
      processes: input.processes,
    });
  }
}
