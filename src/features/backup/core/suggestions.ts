import type { BackupSource, BackupSuggestion } from '../../../core/backupSources';
import { collapsePath, expandPath } from '../../../core/pathVariables';
import { ok } from '../../../core/result';
import { resolveTrackedItem, type TrackedItem } from '../../../core/tracked';
import { pathVariables, type Ctx } from './store';

/** What DCS keeps in its Saved Games folder that is worth having back after a reinstall. */
export const DCS_USER_EXCLUDES = [
  'Logs/**',
  'Tracks/**',
  'Temp/**',
  'fxo/**',
  'metashaders2/**',
  'Screenshots/**',
  'Movies/**',
  'Mods/**',
  'Liveries/**',
];

const DCS_SUGGESTIONS: BackupSuggestion[] = [
  {
    label: 'DCS settings and bindings',
    path: '{DCS_USER}',
    kind: 'folder',
    exclude: DCS_USER_EXCLUDES,
    game: 'dcs',
    description:
      'Everything in Saved Games\\DCS except logs, tracks, caches, screenshots, mods and liveries',
  },
  {
    label: 'DCS bindings',
    path: '{DCS_USER}/Config/Input',
    kind: 'folder',
    game: 'dcs',
    description: 'Controller bindings for every aircraft',
  },
  {
    label: 'DCS options',
    path: '{DCS_USER}/Config/options.lua',
    kind: 'file',
    game: 'dcs',
    description: 'Graphics, audio, VR and gameplay options',
  },
  {
    label: 'DCS monitor setups',
    path: '{DCS_USER}/Config/MonitorSetup',
    kind: 'folder',
    game: 'dcs',
    description: 'Viewports for MFD screens and multi-monitor layouts',
  },
  {
    label: 'DCS export scripts',
    path: '{DCS_USER}/Scripts',
    kind: 'folder',
    game: 'dcs',
    description: 'Export.lua and the tools it loads (DCS-BIOS, SimAppPro, Tacview, ...)',
  },
  {
    label: 'DCS kneeboard',
    path: '{DCS_USER}/Kneeboard',
    kind: 'folder',
    game: 'dcs',
    description: 'Your own kneeboard pages',
  },
];

/** The proving case for backup sources: DCS, built on the DCS game module's {DCS_USER}. */
export const dcsBackupSource: BackupSource = {
  id: 'dcs',
  label: 'DCS World',
  async suggest() {
    // Existence is checked by the caller, which knows the path variables.
    return ok(DCS_SUGGESTIONS);
  },
};

export interface SuggestionView extends BackupSuggestion {
  key: string;
  source: string;
  fileCount: number;
  totalBytes: number;
  /** Ids of the scopes that already track exactly this. */
  trackedIn: string[];
}

const samePatterns = (a: string[] = [], b: string[] = []): boolean =>
  a.length === b.length && a.every((p, i) => p.toLowerCase() === b[i]?.toLowerCase());

export function sameItem(
  a: Pick<TrackedItem, 'path' | 'include' | 'exclude'>,
  b: BackupSuggestion
): boolean {
  return (
    a.path.replace(/\\/g, '/').toLowerCase() === b.path.replace(/\\/g, '/').toLowerCase() &&
    samePatterns(a.include, b.include) &&
    samePatterns(a.exclude, b.exclude)
  );
}

/**
 * Every suggestion from registered backup sources and game modules that exists on this
 * PC, with what it covers right now and where it is already tracked.
 */
export async function collectSuggestions(
  ctx: Ctx,
  scopes: { id: string; items: TrackedItem[] }[]
): Promise<SuggestionView[]> {
  const variables = await pathVariables(ctx);
  const raw: { source: string; suggestion: BackupSuggestion }[] = [];
  for (const source of ctx.backupSources.all()) {
    try {
      const found = await source.suggest(ctx);
      if (found.ok)
        raw.push(...found.value.map((suggestion) => ({ source: source.label, suggestion })));
    } catch (e) {
      ctx.log.error(`backup source ${source.id} threw`, e);
    }
  }
  for (const module of ctx.games.all()) {
    if (!module.trackedFiles) continue;
    try {
      const found = await module.trackedFiles(ctx);
      if (!found.ok) continue;
      for (const s of found.value) {
        const stored = s.path.startsWith('{') ? s.path : collapsePath(s.path, variables);
        const expanded = expandPath(stored, variables);
        const stat = expanded.ok ? await ctx.ports.files.stat(expanded.value) : undefined;
        const kind =
          s.kind ?? (stat?.ok && stat.value && !stat.value.isDirectory ? 'file' : 'folder');
        raw.push({
          source: module.name,
          suggestion: {
            label: s.label,
            path: stored,
            kind,
            game: module.id,
            ...(s.include ? { include: s.include } : {}),
            ...(s.exclude ? { exclude: s.exclude } : {}),
            ...(s.description ? { description: s.description } : {}),
          },
        });
      }
    } catch (e) {
      ctx.log.error(`tracked files of ${module.id} threw`, e);
    }
  }
  const views: SuggestionView[] = [];
  for (const { source, suggestion } of raw) {
    if (views.some((v) => sameItem({ include: [], exclude: [], ...v }, suggestion))) continue;
    const item: TrackedItem = {
      id: 'suggestion',
      label: suggestion.label,
      path: suggestion.path,
      kind: suggestion.kind,
      include: suggestion.include ?? [],
      exclude: suggestion.exclude ?? [],
    };
    const resolved = await resolveTrackedItem(ctx.ports.files, item, variables);
    if (!resolved.exists) continue;
    views.push({
      ...suggestion,
      key: `${views.length}`,
      source,
      fileCount: resolved.files.length,
      totalBytes: resolved.files.reduce((sum, f) => sum + f.size, 0),
      trackedIn: scopes
        .filter((s) => s.items.some((i) => sameItem(i, suggestion)))
        .map((s) => s.id),
    });
  }
  return views;
}
