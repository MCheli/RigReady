import path from 'node:path';
import { z } from 'zod';
import type { CheckContext } from '../../../core/checks/registry';
import type { MainContext } from '../../../core/feature';
import { asAnotherGame, USER_GAME_PREFIX, type GameModule } from '../../../core/games';
import {
  broadFolderTest,
  protectedProgramFileReason,
  protectedProgramReason,
} from '../../../core/guards';
import { JsonStore } from '../../../core/jsonStore';
import {
  collapsePath,
  expandPath,
  standardPathVariables,
  type PathVariables,
} from '../../../core/pathVariables';
import type { Profile } from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import type { GameModuleExtras } from './helpers';
import { simpleGame, standaloneAt } from './simpleGame';
import type { ExtrasById } from './summary';

/**
 * Games the user adds on the Games page ("Add a game"), kept in
 * `<data folder>/games/custom.json` and turned into game modules at start, so that such a
 * game is found, launched, backed up and offered for a setup like one RigReady ships.
 *
 * What a game names decides what RigReady does: its program is started, its settings folders
 * are read by backups and written by restores, its programs are asked to close before a
 * restore. So everything is checked when the game is saved and again whenever the file is
 * read back, because the file can be edited by hand: the program must be a program file
 * outside Windows and RigReady's folder, a settings folder must not be a whole drive,
 * Windows, the user folder or anything as broad (core/guards.ts), and a program name must
 * not be one of Windows' own or RigReady's. What fails is left out and said, never used.
 */

export const USER_GAME_ID = /^user-[a-z0-9][a-z0-9-]{0,39}$/;
/** A program's image name as Windows lists it: no folder, ends in .exe. */
const IMAGE_NAME = /^[^\\/:*?"<>|\x00-\x1f]{1,60}\.exe$/i;
const MAX_FOLDERS = 8;
const MAX_PROCESSES = 8;

export type UserGameKind = 'flight' | 'racing' | 'none';

/** One game as custom.json keeps it. Paths in stored form: {DOCUMENTS}/Star Hauler. */
const EntrySchema = z.object({
  id: z.string().regex(USER_GAME_ID),
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['flight', 'racing', 'none']).default('none'),
  program: z.string().min(1).max(400).optional(),
  settingsFolders: z.array(z.string().min(1).max(400)).max(MAX_FOLDERS).default([]),
  steamAppId: z
    .string()
    .regex(/^\d{1,10}$/)
    .optional(),
  processes: z.array(z.string().max(80)).max(MAX_PROCESSES).default([]),
});
type Entry = z.output<typeof EntrySchema>;

/** The file. Entries are kept as they are, so one spoiled by hand never costs the others. */
const FileSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  games: z.array(z.unknown()).max(200).default([]),
});

export function customGamesFile(ctx: Pick<CheckContext, 'ports'>): string {
  return path.join(ctx.ports.folders.dataRoot(), 'games', 'custom.json');
}

const store = (ctx: Pick<CheckContext, 'ports'>) =>
  new JsonStore(ctx.ports.files, customGamesFile(ctx), FileSchema);

/** A game the user added, as RigReady uses it: paths expanded, everything refused left out. */
export interface UserGame {
  id: string;
  name: string;
  kind: UserGameKind;
  program?: string;
  folders: string[];
  steamAppId?: string;
  processes: string[];
  /** What was left out when the file was read, and why. */
  problems: string[];
}

export interface LoadedUserGames {
  games: UserGame[];
  /** About the file as a whole, or an entry that was left out entirely. */
  problems: string[];
}

/** The path variable a game the user added brings for its first settings folder. */
export function userGameVariable(id: string): string {
  return id.toUpperCase().replace(/-/g, '_');
}

const short = (text: string): string => (text.length > 60 ? `${text.slice(0, 57)}...` : text);

/** Checks one stored entry and expands its paths. Never throws. */
async function vet(
  ctx: Pick<CheckContext, 'ports'>,
  entry: Entry,
  variables: PathVariables,
  tooBroad: (folder: string) => string | undefined
): Promise<UserGame> {
  const problems: string[] = [];
  let program: string | undefined;
  if (entry.program) {
    const expanded = expandPath(entry.program, variables);
    const why = !expanded.ok
      ? expanded.error.message
      : !/\.exe$/i.test(expanded.value)
        ? 'it is not a program file (.exe)'
        : protectedProgramFileReason(ctx.ports, expanded.value);
    if (expanded.ok && !why) program = expanded.value;
    else problems.push(`The program ${short(entry.program)} is not used: ${why}.`);
  }
  const folders: string[] = [];
  for (const stored of entry.settingsFolders) {
    const expanded = expandPath(stored, variables);
    const why = expanded.ok ? tooBroad(expanded.value) : expanded.error.message;
    if (expanded.ok && !why) {
      if (!folders.some((f) => f.toLowerCase() === expanded.value.toLowerCase())) {
        folders.push(expanded.value);
      }
    } else problems.push(`The settings folder ${short(stored)} is not used: ${why}.`);
  }
  const processes: string[] = [];
  for (const name of entry.processes) {
    const why = IMAGE_NAME.test(name)
      ? protectedProgramReason(name)
      : 'it is not the name of a program file';
    if (!why) {
      if (!processes.some((p) => p.toLowerCase() === name.toLowerCase())) processes.push(name);
    } else problems.push(`The program name ${short(name)} is not used: ${why}.`);
  }
  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    ...(program ? { program } : {}),
    folders,
    ...(entry.steamAppId ? { steamAppId: entry.steamAppId } : {}),
    processes,
    problems,
  };
}

/** Reads custom.json and checks every entry. A damaged file is reported and left as it is. */
export async function readUserGames(ctx: Pick<CheckContext, 'ports'>): Promise<LoadedUserGames> {
  const read = await store(ctx).read();
  if (!read.ok) {
    return {
      games: [],
      problems: [
        `Your own games could not be read from ${customGamesFile(ctx)}: ${read.error.message} The file is left as it is.`,
      ],
    };
  }
  const variables = await standardPathVariables(ctx.ports);
  const tooBroad = await broadFolderTest(ctx.ports);
  const games: UserGame[] = [];
  const problems: string[] = [];
  for (const raw of read.value.games) {
    const parsed = EntrySchema.safeParse(raw);
    if (!parsed.success) {
      const name =
        raw && typeof raw === 'object' && typeof (raw as { name?: unknown }).name === 'string'
          ? `"${short((raw as { name: string }).name)}" `
          : '';
      problems.push(
        `A game ${name}in ${path.basename(customGamesFile(ctx))} was left out: it is not a game RigReady can read.`
      );
      continue;
    }
    if (games.some((g) => g.id === parsed.data.id)) {
      problems.push(`A second game with the id ${parsed.data.id} was left out.`);
      continue;
    }
    games.push(await vet(ctx, parsed.data, variables, tooBroad));
  }
  return { games, problems };
}

const NOTE =
  'You added this game. RigReady finds and starts the program you chose, backs up the settings folders you chose, and knows the game is running by its program names. It does not read its bindings.';

/** The game module a game the user added becomes. Built on simpleGame, like most games. */
export function userGameModule(game: UserGame): { module: GameModule; extras: GameModuleExtras } {
  const several = game.folders.length > 1;
  const folderLabel = (folder: string): string =>
    several ? `${game.name} settings (${path.win32.basename(folder)})` : `${game.name} settings`;
  const { module, extras } = simpleGame({
    id: game.id,
    name: game.name,
    ...(game.kind !== 'none' ? { kind: game.kind } : {}),
    ...(game.steamAppId ? { steamAppId: game.steamAppId } : {}),
    async otherInstalls(ctx) {
      if (!game.program) return [];
      const found = await standaloneAt(
        ctx,
        path.win32.dirname(game.program),
        path.win32.basename(game.program)
      );
      return found ? [found] : [];
    },
    processes: game.processes,
    closeWhy: `${game.name} may write its settings when it exits, which would undo the restore.`,
    locations: async () =>
      game.folders.map((folder, i) => ({
        id: `folder-${i + 1}`,
        label: several ? `Settings folder ${i + 1}` : 'Settings folder',
        path: folder,
      })),
    tracked: async () =>
      game.folders.map((folder) => ({
        label: folderLabel(folder),
        path: folder,
        kind: 'folder' as const,
        description: `Everything in the folder you chose for ${game.name}.`,
      })),
    notes: [NOTE],
  });
  const variable = userGameVariable(game.id);
  const first = game.folders[0];
  // A program of the user's own has no version RigReady can read: without a Steam app id the
  // version is left to the Steam library the program may be in, and is otherwise not known,
  // so no "not updated since verified" check compares "unknown" with "unknown".
  const own: GameModule = { ...module };
  if (!game.steamAppId) delete own.installedVersion;
  return {
    module: {
      ...own,
      ...(first
        ? {
            pathVariableLabels: { [variable]: `${game.name} settings folder` },
            async pathVariables(ctx) {
              const variables: Record<string, string> = {};
              if (await ctx.ports.files.exists(first)) variables[variable] = first;
              return ok(variables);
            },
          }
        : {}),
    },
    extras,
  };
}

/** What the user asks for in the dialog, with the program and folders as main picked them. */
export interface UserGameDraft {
  /** Set when an existing game is edited. */
  gameId?: string;
  name: string;
  kind: UserGameKind;
  program?: string;
  folders: string[];
  steamAppId?: string;
  processes: string[];
}

type Ctx = Pick<MainContext, 'ports' | 'log' | 'games' | 'profiles'>;

/**
 * The user's games on this PC: read at start, registered as game modules, and changed only
 * through here, so the registry and the file never disagree for long.
 */
export class UserGames {
  private loaded: LoadedUserGames = { games: [], problems: [] };

  constructor(
    private readonly ctx: Ctx,
    private readonly extras: ExtrasById
  ) {}

  /** Reads the file and (re)registers every game in it. */
  async load(): Promise<void> {
    const next = await readUserGames(this.ctx);
    for (const old of this.loaded.games) this.forget(old.id);
    this.loaded = next;
    for (const game of next.games) {
      if (this.ctx.games.get(game.id)) {
        game.problems.push('A game with the same id is already known; this one is left out.');
        continue;
      }
      const { module, extras } = userGameModule(game);
      this.ctx.games.register(module);
      this.extras.set(game.id, { ...extras, problems: game.problems });
    }
  }

  private forget(id: string): void {
    if (this.ctx.games.get(id)) this.ctx.games.unregister(id);
    this.extras.delete(id);
  }

  list(): UserGame[] {
    return this.loaded.games;
  }

  get(id: string): UserGame | undefined {
    return this.loaded.games.find((g) => g.id === id);
  }

  problems(): string[] {
    return this.loaded.problems;
  }

  /** The setups on this PC that are for the game, by name. */
  async usedBy(id: string): Promise<string[]> {
    const profiles = await this.ctx.profiles.list();
    return (profiles.ok ? profiles.value : []).filter((p) => p.game === id).map((p) => p.name);
  }

  /** Checks a draft the way the file is checked, and words what is wrong. */
  private async check(draft: UserGameDraft): Promise<Result<Omit<UserGame, 'id' | 'problems'>>> {
    const name = draft.name.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 60 || /[\x00-\x1f]/.test(name)) {
      return err('games.custom.name', 'Give the game a name of 1 to 60 characters.');
    }
    const clash = this.ctx.games
      .all()
      .find((g) => g.id !== draft.gameId && g.name.toLowerCase() === name.toLowerCase());
    if (clash) {
      return err('games.custom.name', `RigReady already knows a game called ${clash.name}.`);
    }
    if (!draft.program && !draft.steamAppId) {
      return err(
        'games.custom.program',
        'Choose the program that starts the game, or give its Steam app id.'
      );
    }
    if (draft.program) {
      const why = !/\.exe$/i.test(draft.program)
        ? 'it is not a program file (.exe)'
        : protectedProgramFileReason(this.ctx.ports, draft.program);
      if (why) return err('games.custom.program', `RigReady cannot use ${draft.program}: ${why}.`);
      if (!(await this.ctx.ports.files.exists(draft.program))) {
        return err('games.custom.program', `${draft.program} is not there any more.`);
      }
    }
    const tooBroad = await broadFolderTest(this.ctx.ports);
    const folders: string[] = [];
    for (const folder of draft.folders) {
      const why = tooBroad(folder);
      if (why) return err('games.custom.folder', `RigReady cannot use ${folder}: ${why}.`);
      if (!folders.some((f) => f.toLowerCase() === folder.toLowerCase())) folders.push(folder);
    }
    if (folders.length > MAX_FOLDERS) {
      return err('games.custom.folder', `A game can have at most ${MAX_FOLDERS} settings folders.`);
    }
    const processes: string[] = [];
    for (const raw of draft.processes) {
      const image = raw.trim();
      if (!image) continue;
      if (!IMAGE_NAME.test(image)) {
        return err(
          'games.custom.process',
          `"${short(image)}" is not the name of a program file, such as StarHauler.exe.`
        );
      }
      const why = protectedProgramReason(image);
      if (why) {
        return err('games.custom.process', `RigReady will not treat ${image} as the game: ${why}.`);
      }
      if (!processes.some((p) => p.toLowerCase() === image.toLowerCase())) processes.push(image);
    }
    if (processes.length === 0 && draft.program) processes.push(path.win32.basename(draft.program));
    if (processes.length > MAX_PROCESSES) {
      return err('games.custom.process', `A game can have at most ${MAX_PROCESSES} program names.`);
    }
    return ok({
      name,
      kind: draft.kind,
      ...(draft.program ? { program: draft.program } : {}),
      folders,
      ...(draft.steamAppId ? { steamAppId: draft.steamAppId } : {}),
      processes,
    });
  }

  private async newId(name: string): Promise<string> {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 34)
      .replace(/-+$/, '');
    const base = `${USER_GAME_PREFIX}${slug || 'game'}`;
    const taken = (id: string): boolean =>
      this.ctx.games.get(id) !== undefined || this.loaded.games.some((g) => g.id === id);
    if (!taken(base)) return base;
    for (let n = 2; ; n++) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
  }

  /** Adds a game, or changes one; read back from the file before it is reported. */
  async save(draft: UserGameDraft): Promise<Result<UserGame>> {
    // The file may have changed under the app (a hand edit): start from what it holds.
    await this.load();
    if (draft.gameId && !this.get(draft.gameId)) {
      return err('games.unknown', 'That game is no longer among the games you added.');
    }
    const checked = await this.check(draft);
    if (!checked.ok) return checked;
    const game = checked.value;
    const id = draft.gameId ?? (await this.newId(game.name));
    const variables = await standardPathVariables(this.ctx.ports);
    const entry: Entry = {
      id,
      name: game.name,
      kind: game.kind,
      ...(game.program ? { program: collapsePath(game.program, variables) } : {}),
      settingsFolders: game.folders.map((f) => collapsePath(f, variables)),
      ...(game.steamAppId ? { steamAppId: game.steamAppId } : {}),
      processes: game.processes,
    };
    const written = await store(this.ctx).update((file) => {
      const games = [...file.games];
      const at = games.findIndex((raw) => (raw as { id?: unknown } | null)?.id === id);
      if (at >= 0) games[at] = entry;
      else games.push(entry);
      return { ...file, games };
    });
    if (!written.ok) return written;
    await this.load();
    const saved = this.get(id);
    if (!saved || JSON.stringify(stored(saved, variables)) !== JSON.stringify(entry)) {
      return err(
        'games.custom.notSaved',
        `${game.name} was not saved: ${customGamesFile(this.ctx)} does not hold it after writing.`
      );
    }
    return ok(saved);
  }

  /**
   * Removes a game. The setups for it are not broken: each becomes a setup for "Another
   * game" with the game's name, and every path in it that starts with the game's folder
   * variable is written out in full, so its checks look where they looked before.
   */
  async remove(id: string): Promise<Result<{ name: string; setups: string[] }>> {
    await this.load();
    const game = this.get(id);
    if (!game) return err('games.unknown', 'That game is no longer among the games you added.');
    const profiles = await this.ctx.profiles.list();
    if (!profiles.ok) return profiles;
    const setups = profiles.value.filter((p) => p.game === id);
    const variable = userGameVariable(id);
    const standard = await standardPathVariables(this.ctx.ports);
    /** The setups changed so far, as they were: put back if a later one cannot be changed. */
    const changed: Profile[] = [];
    for (const setup of setups) {
      const converted = withVariableWrittenOut(
        asAnotherGame(setup, game.name),
        variable,
        game.folders[0],
        standard
      );
      const saved = await this.ctx.profiles.save(converted);
      const back = saved.ok ? await this.ctx.profiles.get(setup.id) : saved;
      if (!back.ok || back.value.game !== 'other') {
        // The game stays, so every setup for it stays one: those already changed go back,
        // this one too when it was written but did not read back as "Another game".
        const notBack = await this.putBack(saved.ok ? [...changed, setup] : changed);
        return err(
          'games.custom.setup',
          `${game.name} was not removed: the setup ${setup.name} could not be changed to "Another game".` +
            (notBack.length > 0
              ? ` These setups could not be put back as they were and are now for "Another game": ${notBack.join(', ')}.`
              : ' Every setup for it is as it was.'),
          back.ok ? undefined : back.error.message
        );
      }
      changed.push(setup);
    }
    const written = await store(this.ctx).update((file) => ({
      ...file,
      games: file.games.filter((raw) => (raw as { id?: unknown } | null)?.id !== id),
    }));
    if (!written.ok) return written;
    await this.load();
    if (this.get(id)) {
      return err(
        'games.custom.notRemoved',
        `${game.name} was not removed: ${customGamesFile(this.ctx)} still holds it after writing.`
      );
    }
    return ok({ name: game.name, setups: setups.map((s) => s.name) });
  }

  /**
   * Saves setups again as they were before a Remove that did not finish, each read back.
   * Returns the names of the ones that could not be put back.
   */
  private async putBack(setups: Profile[]): Promise<string[]> {
    const notBack: string[] = [];
    for (const setup of setups) {
      const saved = await this.ctx.profiles.save(setup);
      const back = saved.ok ? await this.ctx.profiles.get(setup.id) : saved;
      if (!back.ok || back.value.game !== setup.game) notBack.push(setup.name);
    }
    return notBack;
  }
}

/** An entry as it would be stored for a game, to compare what was written with what is read. */
function stored(game: UserGame, variables: PathVariables): Entry {
  return {
    id: game.id,
    name: game.name,
    kind: game.kind,
    ...(game.program ? { program: collapsePath(game.program, variables) } : {}),
    settingsFolders: game.folders.map((f) => collapsePath(f, variables)),
    ...(game.steamAppId ? { steamAppId: game.steamAppId } : {}),
    processes: game.processes,
  };
}

/**
 * Every string in a setup that starts with {VARIABLE}, written out under `folder` (in the
 * standard variables where one covers it: {DOCUMENTS}/Star Hauler/settings.ini), for a setup
 * whose game, and with it the variable, goes away. Without the folder nothing is changed:
 * such a path was not resolvable here before either.
 */
export function withVariableWrittenOut(
  setup: Profile,
  variable: string,
  folder: string | undefined,
  standard: PathVariables
): Profile {
  if (!folder) return setup;
  const prefix = `{${variable}}`;
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (value !== prefix && !value.startsWith(`${prefix}/`) && !value.startsWith(`${prefix}\\`))
        return value;
      const expanded = expandPath(value, { [variable]: folder });
      return expanded.ok ? collapsePath(expanded.value, standard) : value;
    }
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };
  return walk(setup) as Profile;
}
