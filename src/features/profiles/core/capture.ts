import { captureCandidates } from '../../../core/checks/engine';
import type { CaptureCandidate } from '../../../core/checks/registry';
import type { MainContext } from '../../../core/feature';
import { allPathVariables, collapsePath, expandPath } from '../../../core/pathVariables';
import { BACKUP_EXTENSION, type TrackedItem } from '../../../core/tracked';
import { slugify } from '../../../core/profile/schema';
import type { GameKind } from '../../../shared/models';
import type { CaptureGame, CaptureResult, CaptureTracked, NewProfile } from '../contract';

type Ctx = Pick<MainContext, 'ports' | 'profiles' | 'checks' | 'games' | 'log' | 'backupSources'>;

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Every game module with what was found of it on this PC: installs, launch target, running or not. */
export async function captureGames(ctx: Ctx): Promise<CaptureGame[]> {
  const listed = await ctx.ports.processes.list();
  const running = listed.ok ? listed.value : [];
  const games: CaptureGame[] = [];
  for (const module of ctx.games.all()) {
    try {
      const installs = await module.detect(ctx);
      games.push({
        id: module.id,
        name: module.name,
        ...(module.kind ? { kind: module.kind } : {}),
        running: (module.processes ?? []).some((image) =>
          running.some((p) => sameName(p.name, image))
        ),
        installs: installs.ok
          ? installs.value.map((i) => ({
              installDir: i.installDir,
              source: i.source,
              ...(i.launch ? { launch: i.launch } : {}),
            }))
          : [],
      });
    } catch (e) {
      ctx.log.error(`detect ${module.id} threw`, e);
    }
  }
  return games;
}

/**
 * The family of sims the connected gear is for: the one most of the game controllers
 * belong to. Undefined when there is none or it is a tie.
 */
export function rigKind(candidates: CaptureCandidate[]): GameKind | undefined {
  let flight = 0;
  let racing = 0;
  for (const candidate of candidates) {
    if (!candidate.device?.gameController) continue;
    if (candidate.kind === 'flight') flight += 1;
    else if (candidate.kind === 'racing') racing += 1;
  }
  if (flight === racing) return undefined;
  return flight > racing ? 'flight' : 'racing';
}

/**
 * The game a new setup is most likely for, when the PC says so clearly: the game that is
 * running, else the only installed game of the rig's family, else the only one of that
 * family the user has bindings of their own for. Otherwise the user chooses.
 */
export function suggestGame(
  games: CaptureGame[],
  candidates: CaptureCandidate[]
): CaptureResult['suggested'] {
  const kind = rigKind(candidates);
  const base = kind ? { kind } : {};
  const installed = games.filter((g) => g.installs.length > 0);
  const runningNow = installed.filter((g) => g.running);
  if (runningNow.length === 1) {
    return { ...base, game: runningNow[0]!.id, reason: `${runningNow[0]!.name} is running now` };
  }
  const family = kind ? installed.filter((g) => g.kind === kind) : installed;
  const gear = kind === 'flight' ? 'flight gear' : kind === 'racing' ? 'racing gear' : 'gear';
  if (family.length === 1) {
    const only = family[0]!;
    return {
      ...base,
      game: only.id,
      reason: kind
        ? `The ${gear} is connected and ${only.name} is the only ${kind} sim installed`
        : `${only.name} is the only game found`,
    };
  }
  const bound = family.filter((g) => candidates.some((c) => c.game === g.id && c.variant));
  if (bound.length === 1) {
    return {
      ...base,
      game: bound[0]!.id,
      reason: `The ${gear} is connected and ${bound[0]!.name} has your bindings`,
    };
  }
  return base;
}

const normal = (stored: string): string => stored.replace(/\\/g, '/').toLowerCase();

/**
 * What a setup could back up: every suggestion of the backup sources and the game
 * modules that exists on this PC, in stored form ({DCS_USER}/Config/Input). The first
 * suggestion of each game is its whole settings folder and is kept by default in a
 * setup for that game.
 */
export async function trackedSuggestions(ctx: Ctx): Promise<CaptureTracked[]> {
  const variables = await allPathVariables(ctx, ctx.games);
  const found: CaptureTracked[] = [];
  const seen = new Set<string>();
  const gamesWithDefault = new Set<string>();
  const add = async (
    source: string,
    suggestion: {
      label: string;
      path: string;
      kind?: 'file' | 'folder';
      include?: string[];
      exclude?: string[];
      game?: string;
      variant?: string;
      description?: string;
    }
  ): Promise<void> => {
    const absolute = expandPath(suggestion.path, variables);
    if (!absolute.ok) return;
    const stat = await ctx.ports.files.stat(absolute.value);
    if (!stat.ok || !stat.value) return;
    const stored = collapsePath(absolute.value, variables);
    const key = [normal(stored), ...(suggestion.include ?? []), '!', ...(suggestion.exclude ?? [])]
      .join('|')
      .toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const first =
      suggestion.game !== undefined &&
      suggestion.variant === undefined &&
      !gamesWithDefault.has(suggestion.game);
    if (first) gamesWithDefault.add(suggestion.game!);
    found.push({
      key: `tracked:${found.length}:${normal(stored)}`,
      source,
      label: suggestion.label.slice(0, 80),
      path: stored,
      kind: suggestion.kind ?? (stat.value.isDirectory ? 'folder' : 'file'),
      include: suggestion.include ?? [],
      exclude: suggestion.exclude ?? [],
      ...(suggestion.game ? { game: suggestion.game } : {}),
      ...(suggestion.variant ? { variant: suggestion.variant } : {}),
      ...(suggestion.description ? { description: suggestion.description } : {}),
      selectedByDefault: first,
    });
  };
  for (const source of ctx.backupSources.all()) {
    try {
      const suggested = await source.suggest(ctx);
      if (!suggested.ok) continue;
      for (const suggestion of suggested.value) await add(source.label, suggestion);
    } catch (e) {
      ctx.log.error(`backup source ${source.id} threw`, e);
    }
  }
  for (const module of ctx.games.all()) {
    if (!module.trackedFiles) continue;
    try {
      const suggested = await module.trackedFiles(ctx);
      if (!suggested.ok) continue;
      for (const suggestion of suggested.value) {
        await add(module.name, { ...suggestion, game: module.id });
      }
    } catch (e) {
      ctx.log.error(`tracked files of ${module.id} threw`, e);
    }
  }
  return found;
}

/** Everything the capture screen shows: the rig as it is now, as proposals. */
export async function captureRig(ctx: Ctx): Promise<CaptureResult> {
  const { candidates, problems } = await captureCandidates(ctx.checks, ctx);
  const games = await captureGames(ctx);
  return {
    candidates,
    problems,
    games,
    tracked: await trackedSuggestions(ctx),
    suggested: suggestGame(games, candidates),
  };
}

/** The tracked items a new setup starts with, as the backup feature keeps them in a profile. */
export function trackedExtension(
  tracked: NonNullable<NewProfile['tracked']>
): Record<string, unknown> {
  if (tracked.length === 0) return {};
  const ids = new Set<string>();
  const items: TrackedItem[] = tracked.map((item) => {
    const base = slugify(item.label);
    let id = base;
    for (let n = 2; ids.has(id); n += 1) id = `${base.slice(0, 60)}-${n}`;
    ids.add(id);
    return {
      id,
      label: item.label,
      path: item.path,
      kind: item.kind,
      include: item.include,
      exclude: item.exclude,
      ...(item.game ? { game: item.game } : {}),
    };
  });
  return { [BACKUP_EXTENSION]: { items } };
}
