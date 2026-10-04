import path from 'node:path';
import type { HoldingProgram } from '../../../core/backupSources';
import { isWithin } from '../../../core/paths';
import { expandPath } from '../../../core/pathVariables';
import type { ProcessInfo } from '../../../shared/models';
import { err, ok, type Result } from '../../../core/result';
import { pathVariables, type Ctx } from './store';

/**
 * Games and tools that write their settings when they quit (or keep them open) undo a
 * restore made while they run. Game modules say so with `processes` and
 * `closeBeforeRestore`; tools with `program` on their backup source. This is where a
 * restore finds out which of them hold the files it is about to write.
 */

interface Holder {
  id: string;
  program: HoldingProgram;
  /** Game module id, when the holder is a game. */
  game?: string;
  /** Folders and files the program owns on this PC. */
  roots: string[];
}

export interface RunningProgram {
  id: string;
  name: string;
  why: string;
  /** Image names of it that are running now. */
  processes: string[];
  /** RigReady starts it again after a restore that closed it. */
  restart: boolean;
  /** Labels of the backup's items whose files it holds. */
  items: string[];
}

export interface ClosedProgram {
  name: string;
  /** True when it was started again, false when that failed; absent when it is left closed. */
  restarted?: boolean;
}

/** A file or folder a restore is about to write, with the item it belongs to. */
export interface RestoreTarget {
  label: string;
  target: string;
  game?: string;
}

const overlaps = (a: string, b: string): boolean => isWithin(a, b) || isWithin(b, a);

async function holders(ctx: Ctx): Promise<Holder[]> {
  const variables = await pathVariables(ctx);
  const out: Holder[] = [];
  for (const module of ctx.games.all()) {
    const processes = module.closeBeforeRestore?.processes ?? module.processes ?? [];
    if (processes.length === 0) continue;
    const roots: string[] = [];
    try {
      const locations = await module.configLocations(ctx);
      if (locations.ok) roots.push(...locations.value.map((l) => l.path));
      const tracked = module.trackedFiles ? await module.trackedFiles(ctx) : undefined;
      if (tracked?.ok) {
        for (const t of tracked.value) {
          const expanded = t.path.startsWith('{') ? expandPath(t.path, variables) : undefined;
          if (!expanded) roots.push(t.path);
          else if (expanded.ok) roots.push(expanded.value);
        }
      }
    } catch (e) {
      ctx.log.error(`config locations of ${module.id} threw`, e);
    }
    out.push({
      id: `game:${module.id}`,
      game: module.id,
      program: {
        name: module.name,
        processes,
        why:
          module.closeBeforeRestore?.why ??
          `${module.name} may write its settings again when it exits, which would undo the restore.`,
      },
      roots,
    });
  }
  for (const source of ctx.backupSources.all()) {
    if (!source.program) continue;
    const roots: string[] = [];
    try {
      const suggested = await source.suggest(ctx);
      for (const s of suggested.ok ? suggested.value : []) {
        const expanded = s.path.startsWith('{') ? expandPath(s.path, variables) : undefined;
        if (!expanded) roots.push(s.path);
        else if (expanded.ok) roots.push(expanded.value);
      }
    } catch (e) {
      ctx.log.error(`backup source ${source.id} threw`, e);
    }
    out.push({ id: `source:${source.id}`, program: source.program, roots });
  }
  return out;
}

const runningOf = (program: HoldingProgram, processes: ProcessInfo[]): ProcessInfo[] => {
  const names = new Set(program.processes.map((p) => p.toLowerCase()));
  return processes.filter((p) => names.has(p.name.toLowerCase()));
};

/**
 * The programs running now that hold files among `targets`. An error when the list of
 * running programs cannot be read: a restore must not go ahead on a guess.
 */
export async function runningHolders(
  ctx: Ctx,
  targets: RestoreTarget[]
): Promise<Result<RunningProgram[]>> {
  if (targets.length === 0) return ok([]);
  const list = await ctx.ports.processes.list();
  if (!list.ok) {
    return err(
      'restore.processes',
      'RigReady could not see which programs are running, so it cannot tell whether a game would overwrite the restored files.',
      list.error.message
    );
  }
  const out: RunningProgram[] = [];
  for (const holder of await holders(ctx)) {
    const running = runningOf(holder.program, list.value);
    if (running.length === 0) continue;
    const items = targets.filter(
      (t) =>
        (holder.game !== undefined && t.game === holder.game) ||
        holder.roots.some((root) => overlaps(path.resolve(root), path.resolve(t.target)))
    );
    if (items.length === 0) continue;
    out.push({
      id: holder.id,
      name: holder.program.name,
      why: holder.program.why,
      processes: [...new Set(running.map((p) => p.name))],
      restart: holder.program.restart === true,
      items: [...new Set(items.map((t) => t.label))],
    });
  }
  return ok(out);
}

/** "iRacing is running. iRacing writes these files when the simulator exits..." */
export function runningText(programs: RunningProgram[]): string {
  return programs
    .map((p) => `${p.name} is running (${p.processes.join(', ')}). ${p.why}`)
    .join(' ');
}

export interface Reopen {
  name: string;
  exe?: string;
}

/**
 * Asks each program to close, the way its own Exit would, and waits. Never ends a
 * program by force: one that does not close is named and the restore does not start.
 * Resolves with the tools to start again afterwards.
 */
export async function closeHolders(
  ctx: Ctx,
  programs: RunningProgram[],
  waitMs = 15_000
): Promise<Result<Reopen[]>> {
  const list = await ctx.ports.processes.list();
  if (!list.ok) return list;
  const reopen: Reopen[] = [];
  for (const program of programs) {
    const names = new Set(program.processes.map((p) => p.toLowerCase()));
    const targets = list.value.filter((p) => names.has(p.name.toLowerCase()));
    for (const target of targets) {
      const closed = await ctx.ports.processes.close(target.pid, { waitMs, force: false });
      if (!closed.ok) {
        return err(
          'restore.stillRunning',
          `${program.name} did not close when asked. Close it yourself, then restore again. Nothing was restored.`,
          closed.error.message
        );
      }
    }
    if (program.restart) {
      const exe = targets.find((t) => t.path)?.path;
      reopen.push({ name: program.name, ...(exe ? { exe } : {}) });
    }
  }
  const after = await ctx.ports.processes.list();
  if (!after.ok) return after;
  for (const program of programs) {
    const names = new Set(program.processes.map((p) => p.toLowerCase()));
    if (after.value.some((p) => names.has(p.name.toLowerCase()))) {
      return err(
        'restore.stillRunning',
        `${program.name} is still running. Close it yourself, then restore again. Nothing was restored.`
      );
    }
  }
  return ok(reopen);
}

/** Starts the tools a restore closed. A game is never started here. */
export async function reopenHolders(ctx: Ctx, reopen: Reopen[]): Promise<ClosedProgram[]> {
  const out: ClosedProgram[] = [];
  for (const program of reopen) {
    if (!program.exe) {
      out.push({ name: program.name, restarted: false });
      continue;
    }
    const started = await ctx.ports.processes.start({ exe: program.exe, args: [] });
    out.push({ name: program.name, restarted: started.ok });
  }
  return out;
}
