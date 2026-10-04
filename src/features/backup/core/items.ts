import path from 'node:path';
import { credentialReason } from '../../../core/credentials';
import { allowedRoots, isWithin } from '../../../core/paths';
import {
  collapsePath,
  expandPath,
  standardPathVariables,
  variableOf,
  type PathVariables,
} from '../../../core/pathVariables';
import { err, ok, type Result } from '../../../core/result';
import { resolveTrackedItem, type TrackedItem } from '../../../core/tracked';
import { allScopes, itemsOf, newItemId, pathVariables, setItemsOf, type Ctx } from './store';
import { collectSuggestions } from './suggestions';

export interface ItemView {
  item: TrackedItem;
  absolute?: string;
  problem?: string;
  exists: boolean;
  fileCount: number;
  totalBytes: number;
  withheld: number;
}

export interface ScopeView {
  id: string;
  name: string;
  game?: string;
  items: ItemView[];
}

export async function scopeViews(ctx: Ctx): Promise<Result<ScopeView[]>> {
  const scopes = await allScopes(ctx);
  if (!scopes.ok) return scopes;
  const variables = await pathVariables(ctx);
  const views: ScopeView[] = [];
  for (const scope of scopes.value) {
    const items: ItemView[] = [];
    for (const item of scope.items) {
      const r = await resolveTrackedItem(ctx.ports.files, item, variables);
      items.push({
        item,
        ...(r.absolute ? { absolute: r.absolute } : {}),
        ...(r.problem ? { problem: r.problem } : {}),
        exists: r.exists,
        fileCount: r.files.length,
        totalBytes: r.files.reduce((sum, f) => sum + f.size, 0),
        withheld: r.withheld.length,
      });
    }
    views.push({
      id: scope.id,
      name: scope.name,
      ...(scope.game ? { game: scope.game } : {}),
      items,
    });
  }
  return ok(views);
}

export interface ItemDraft {
  id?: string;
  label: string;
  path: string;
  kind: 'file' | 'folder';
  include: string[];
  exclude: string[];
  game?: string;
}

/** Validates a path typed or picked by the user and stores it with a variable when one covers it. */
export async function normalizeDraftPath(ctx: Ctx, raw: string): Promise<Result<string>> {
  const variables = await pathVariables(ctx);
  const trimmed = raw.trim().replace(/^"|"$/g, '');
  if (!trimmed) return err('item.path', 'Enter a path.');
  const stored = variableOf(trimmed)
    ? trimmed.replace(/\\/g, '/')
    : collapsePath(trimmed, variables);
  const expanded = expandPath(stored, variables);
  if (!expanded.ok) {
    return err(
      'item.path',
      expanded.error.code === 'path.relative'
        ? 'Enter a full path such as C:\\Games\\Tool\\settings.ini, or start with a variable such as {DOCUMENTS}.'
        : expanded.error.message
    );
  }
  if (isWithin(ctx.ports.folders.dataRoot(), expanded.value)) {
    return err('item.path', "RigReady's own folder is part of every full backup already.");
  }
  if (!(await mayTrack(ctx, expanded.value, variables))) {
    return err(
      'path.outside',
      'That path is outside the folders RigReady may use (Documents, Saved Games, AppData, the Steam libraries and the game folders).',
      'Choose it with Browse instead.'
    );
  }
  const why = credentialReason(expanded.value, variables);
  if (why) return err('item.credentials', `That file is never backed up: ${why}.`);
  return ok(stored);
}

/**
 * Paths the user chose in a native file picker this session, per running app. The picker
 * is the user's own word that RigReady may use that file or folder, wherever it is; the
 * list lives in main, so the renderer cannot add to it.
 */
const picked = new WeakMap<object, string[]>();

function rememberPicked(ctx: Ctx, absolute: string): void {
  const list = picked.get(ctx.ports) ?? [];
  list.push(path.resolve(absolute));
  picked.set(ctx.ports, list);
}

/**
 * Whether a path that arrived from the renderer may be tracked (read into backups, written
 * by a restore). Yes when it is under the allowed roots (Documents, Saved Games, AppData,
 * the Steam libraries) or a game's own folder; or when main itself vouches for it: picked
 * in the native dialog this session, already tracked, or offered as a suggestion by a game
 * module or a backup source. Anything else is refused: the Windows folder, another user's
 * folder, a network or device path.
 */
async function mayTrack(ctx: Ctx, absolute: string, variables: PathVariables): Promise<boolean> {
  const within = (roots: string[]): boolean => roots.some((root) => isWithin(root, absolute));
  if (within(picked.get(ctx.ports) ?? [])) return true;
  // A drive letter only: never \\server\share, \\?\C:\... or \\.\device.
  if (!/^[a-zA-Z]:[\\/]/.test(absolute)) return false;
  if (within(await allowedRoots(ctx.ports))) return true;
  // The folders of the games (DCS_INSTALL, DCS_USER, ...): every variable a game module adds.
  const standard = await standardPathVariables(ctx.ports);
  const gameFolders = Object.entries(variables)
    .filter(([name]) => !(name in standard))
    .map(([, folder]) => folder);
  if (within(gameFolders)) return true;
  const expandAll = (stored: string[]): string[] =>
    stored.flatMap((p) => {
      const expanded = expandPath(p, variables);
      return expanded.ok ? [expanded.value] : [];
    });
  const scopes = await allScopes(ctx);
  if (!scopes.ok) return false;
  if (within(expandAll(scopes.value.flatMap((s) => s.items.map((i) => i.path))))) return true;
  const suggestions = await collectSuggestions(ctx, scopes.value);
  return within(expandAll(suggestions.map((s) => s.path)));
}

export interface ItemPreview {
  path: string;
  absolute?: string;
  problem?: string;
  exists: boolean;
  kind: 'file' | 'folder';
  files: { relativePath: string; size: number }[];
  fileCount: number;
  totalBytes: number;
  withheld: { relativePath: string; reason: string }[];
}

const PREVIEW_LIMIT = 400;

/** Which files an item would cover right now, before it is saved. */
export async function previewItem(ctx: Ctx, draft: ItemDraft): Promise<Result<ItemPreview>> {
  const stored = await normalizeDraftPath(ctx, draft.path);
  if (!stored.ok) return stored;
  const variables = await pathVariables(ctx);
  const expanded = expandPath(stored.value, variables);
  const stat = expanded.ok ? await ctx.ports.files.stat(expanded.value) : undefined;
  // A path that exists decides the kind; otherwise keep what the user chose.
  const kind = stat?.ok && stat.value ? (stat.value.isDirectory ? 'folder' : 'file') : draft.kind;
  const item: TrackedItem = {
    id: 'preview',
    label: draft.label || 'Preview',
    path: stored.value,
    kind,
    include: draft.include,
    exclude: draft.exclude,
  };
  const r = await resolveTrackedItem(ctx.ports.files, item, variables);
  return ok({
    path: stored.value,
    ...(r.absolute ? { absolute: r.absolute } : {}),
    ...(r.problem ? { problem: r.problem } : {}),
    exists: r.exists,
    kind,
    files: r.files
      .slice(0, PREVIEW_LIMIT)
      .map((f) => ({ relativePath: f.relativePath, size: f.size })),
    fileCount: r.files.length,
    totalBytes: r.files.reduce((sum, f) => sum + f.size, 0),
    withheld: r.withheld,
  });
}

const cleanPatterns = (patterns: string[]): string[] => [
  ...new Set(patterns.map((p) => p.trim().replace(/\\/g, '/')).filter(Boolean)),
];

export async function saveItem(
  ctx: Ctx,
  scope: string,
  draft: ItemDraft
): Promise<Result<TrackedItem>> {
  const items = await itemsOf(ctx, scope);
  if (!items.ok) return items;
  const label = draft.label.trim();
  if (!label || label.length > 80)
    return err('item.label', 'Give the item a name of 1 to 80 characters.');
  const preview = await previewItem(ctx, draft);
  if (!preview.ok) return preview;
  const existing = draft.id ? items.value.find((i) => i.id === draft.id) : undefined;
  if (draft.id && !existing) return err('item.missing', 'That item is no longer tracked.');
  const item: TrackedItem = {
    id: existing?.id ?? newItemId(label, items.value),
    label,
    path: preview.value.path,
    kind: preview.value.kind,
    include: preview.value.kind === 'folder' ? cleanPatterns(draft.include) : [],
    exclude: preview.value.kind === 'folder' ? cleanPatterns(draft.exclude) : [],
    ...(draft.game ? { game: draft.game } : {}),
  };
  const next = existing
    ? items.value.map((i) => (i.id === existing.id ? item : i))
    : [...items.value, item];
  const saved = await setItemsOf(ctx, scope, next);
  return saved.ok ? ok(item) : saved;
}

export async function removeItem(ctx: Ctx, scope: string, id: string): Promise<Result<void>> {
  const items = await itemsOf(ctx, scope);
  if (!items.ok) return items;
  if (!items.value.some((i) => i.id === id))
    return err('item.missing', 'That item is no longer tracked.');
  return setItemsOf(
    ctx,
    scope,
    items.value.filter((i) => i.id !== id)
  );
}

/** A native picker for a file or folder to track. Resolves with the stored path, or null when cancelled. */
export async function browseForItem(
  ctx: Ctx,
  kind: 'file' | 'folder'
): Promise<Result<{ path: string; label: string } | null>> {
  const picked = await ctx.ports.dialogs.open({
    title: kind === 'folder' ? 'Choose a folder to back up' : 'Choose a file to back up',
    directory: kind === 'folder',
  });
  if (!picked.ok) return picked;
  const first = picked.value[0];
  if (!first) return ok(null);
  // Chosen by the user in the native picker: remembered here, in main, for this session.
  rememberPicked(ctx, first);
  const stored = await normalizeDraftPath(ctx, first);
  if (!stored.ok) return stored;
  return ok({ path: stored.value, label: path.basename(first) });
}
