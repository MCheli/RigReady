import path from 'node:path';
import { z } from 'zod';
import type {
  CaptureCandidate,
  CaptureDefinition,
  CheckDefinition,
} from '../../../core/checks/registry';
import type { GameRegistry } from '../../../core/games';
import { LuaTable, parseLuaData, type LuaValue } from '../../../core/lua/data';
import { allPathVariables, collapsePath } from '../../../core/pathVariables';
import { err, ok, type Result } from '../../../core/result';
import { fileName, resolveStored } from './paths';

export const FILE_EXISTS = 'file.exists';
export const FILE_CONTENT = 'file.content';
const FILE_FIXES = ['file.restore', 'instructions.show', 'script.run'];

export const FileExistsParamsSchema = z
  .object({
    /** {DCS_USER}/Config/options.lua, or an absolute path. */
    path: z.string().min(1),
    /** A file, or a folder. */
    kind: z.enum(['file', 'folder']).default('file'),
    /** Folder only: at least one file below it must match this pattern, e.g. *.diff.lua. */
    pattern: z.string().min(1).optional(),
  })
  .refine((p) => p.kind === 'folder' || p.pattern === undefined, {
    message: 'A pattern only applies to a folder',
    path: ['pattern'],
  });
export type FileExistsParams = z.infer<typeof FileExistsParamsSchema>;

export function createFileExistsCheck(games: GameRegistry): CheckDefinition<FileExistsParams> {
  return {
    type: FILE_EXISTS,
    group: 'files',
    label: 'Config file or folder present',
    params: FileExistsParamsSchema,
    fixes: FILE_FIXES,
    async run(params, ctx) {
      const target = await resolveStored(params.path, ctx, games);
      if (!target.ok) {
        return {
          pass: false,
          error: true,
          summary: target.error.message,
          details: target.error.detail ? [target.error.detail] : [],
        };
      }
      const stat = await ctx.ports.files.stat(target.value);
      if (!stat.ok) return { pass: false, error: true, summary: stat.error.message };
      if (!stat.value) return { pass: false, summary: 'Missing', details: [target.value] };
      if (params.kind === 'file') {
        if (stat.value.isDirectory) {
          return {
            pass: false,
            summary: 'This is a folder, a file was expected',
            details: [target.value],
          };
        }
        return { pass: true, summary: 'Present' };
      }
      if (!stat.value.isDirectory) {
        return {
          pass: false,
          summary: 'This is a file, a folder was expected',
          details: [target.value],
        };
      }
      if (!params.pattern) return { pass: true, summary: 'Present' };
      const tree = await ctx.ports.files.listTree(target.value, {
        include: [params.pattern],
        maxEntries: 5000,
      });
      if (!tree.ok) return { pass: false, error: true, summary: tree.error.message };
      const count = tree.value.length;
      return count > 0
        ? { pass: true, summary: `${count} matching ${count === 1 ? 'file' : 'files'}` }
        : { pass: false, summary: `No file matches ${params.pattern}`, details: [target.value] };
    },
  };
}

export const FileContentParamsSchema = z
  .object({
    path: z.string().min(1),
    /**
     * contains: the text appears. regex: the pattern matches. equals: the value at keyPath
     * (Lua: options.graphics.multiMonitorSetup; INI: Section.key; JSON: a.b.0.c) is `value`.
     */
    rule: z.enum(['contains', 'regex', 'equals']),
    value: z.string(),
    keyPath: z.string().min(1).optional(),
    /** How to read the file for "equals". auto: by its extension. */
    format: z.enum(['auto', 'lua', 'ini', 'json']).default('auto'),
  })
  .superRefine((p, issue) => {
    if (p.rule === 'equals' && !p.keyPath) {
      issue.addIssue({ code: 'custom', message: 'Say which key to compare', path: ['keyPath'] });
    }
    if (p.rule === 'regex') {
      try {
        new RegExp(p.value);
      } catch {
        issue.addIssue({ code: 'custom', message: 'Not a valid pattern', path: ['value'] });
      }
    }
  });
export type FileContentParams = z.infer<typeof FileContentParamsSchema>;

type Format = 'lua' | 'ini' | 'json';

function formatOf(params: FileContentParams, file: string): Format | undefined {
  if (params.format !== 'auto') return params.format;
  const ext = path.extname(file).toLowerCase();
  if (ext === '.lua') return 'lua';
  if (ext === '.ini' || ext === '.cfg') return 'ini';
  if (ext === '.json') return 'json';
  return undefined;
}

const NOT_FOUND = Symbol('not found');
type Found = string | typeof NOT_FOUND;

function show(value: unknown): string {
  if (value === null || value === undefined) return 'nil';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function luaValueAt(text: string, keyPath: string): Result<Found> {
  const doc = parseLuaData(text);
  if (!doc.ok) return doc;
  const [head, ...rest] = keyPath.split('.');
  let current: LuaValue | undefined = doc.value.get(head!);
  for (const part of rest) {
    if (!(current instanceof LuaTable)) return ok(NOT_FOUND);
    const numeric = /^\d+$/.test(part) ? Number(part) : undefined;
    current = current.get(part) ?? (numeric !== undefined ? current.get(numeric) : undefined);
  }
  if (current === undefined) return ok(NOT_FOUND);
  return ok(current instanceof LuaTable ? show(current.toJs()) : show(current));
}

function iniValueAt(text: string, keyPath: string): Found {
  const dot = keyPath.lastIndexOf('.');
  const section = dot >= 0 ? keyPath.slice(0, dot).toLowerCase() : '';
  const key = (dot >= 0 ? keyPath.slice(dot + 1) : keyPath).toLowerCase();
  let current = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = header[1]!.trim().toLowerCase();
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0 || line.startsWith(';') || line.startsWith('#')) continue;
    if (current !== section || line.slice(0, eq).trim().toLowerCase() !== key) continue;
    // Values may carry a trailing "; comment" (iRacing's app.ini does).
    return line
      .slice(eq + 1)
      .replace(/\s+[;#].*$/, '')
      .trim();
  }
  return NOT_FOUND;
}

function jsonValueAt(text: string, keyPath: string): Result<Found> {
  let current: unknown;
  try {
    current = JSON.parse(text);
  } catch (e) {
    return err('json.parse', 'Not a JSON file.', String(e));
  }
  for (const part of keyPath.split('.')) {
    if (current === null || typeof current !== 'object') return ok(NOT_FOUND);
    current = (current as Record<string, unknown>)[part];
  }
  return ok(current === undefined ? NOT_FOUND : show(current));
}

export function createFileContentCheck(games: GameRegistry): CheckDefinition<FileContentParams> {
  return {
    type: FILE_CONTENT,
    group: 'files',
    label: 'Config file content',
    params: FileContentParamsSchema,
    fixes: FILE_FIXES,
    async run(params, ctx) {
      const target = await resolveStored(params.path, ctx, games);
      if (!target.ok) {
        return {
          pass: false,
          error: true,
          summary: target.error.message,
          details: target.error.detail ? [target.error.detail] : [],
        };
      }
      if (!(await ctx.ports.files.exists(target.value))) {
        return { pass: false, summary: 'Missing', details: [target.value] };
      }
      const text = await ctx.ports.files.readText(target.value);
      if (!text.ok) return { pass: false, error: true, summary: text.error.message };
      if (params.rule === 'contains') {
        return text.value.includes(params.value)
          ? { pass: true, summary: `Contains "${params.value}"` }
          : { pass: false, summary: `Does not contain "${params.value}"` };
      }
      if (params.rule === 'regex') {
        return new RegExp(params.value, 'm').test(text.value)
          ? { pass: true, summary: `Matches ${params.value}` }
          : { pass: false, summary: `Does not match ${params.value}` };
      }
      const keyPath = params.keyPath!;
      const format = formatOf(params, target.value);
      if (!format) {
        return {
          pass: false,
          error: true,
          summary: `Cannot read keys from ${fileName(target.value)}: choose Lua, INI or JSON.`,
        };
      }
      const found: Result<Found> =
        format === 'lua'
          ? luaValueAt(text.value, keyPath)
          : format === 'json'
            ? jsonValueAt(text.value, keyPath)
            : ok(iniValueAt(text.value, keyPath));
      if (!found.ok) {
        return {
          pass: false,
          error: true,
          summary: found.error.message,
          details: found.error.detail ? [found.error.detail] : [],
        };
      }
      const key = keyPath.split('.').pop()!;
      if (found.value === NOT_FOUND) {
        return { pass: false, summary: `${key} is not set, expected ${params.value}` };
      }
      return found.value === params.value
        ? { pass: true, summary: `${key} is ${params.value}` }
        : { pass: false, summary: `${key} is ${found.value}, expected ${params.value}` };
    },
  };
}

/**
 * Proposes file checks for what each detected game says is worth tracking. Nothing is
 * pre-ticked here; the capture screen ticks the chosen game's files.
 */
export function createFileCapture(games: GameRegistry): CaptureDefinition {
  return {
    id: 'files',
    label: 'Config files',
    async capture(ctx) {
      const variables = await allPathVariables(ctx, games);
      const candidates: CaptureCandidate[] = [];
      for (const module of games.all()) {
        if (!module.trackedFiles) continue;
        const tracked = await module.trackedFiles(ctx);
        if (!tracked.ok) continue;
        for (const file of tracked.value) {
          const stat = await ctx.ports.files.stat(file.path);
          if (!stat.ok || !stat.value) continue;
          const stored = collapsePath(file.path, variables);
          candidates.push({
            key: `file:${module.id}:${stored}`,
            group: 'files',
            title: file.label,
            description: `${module.name} · ${stored}`,
            selectedByDefault: false,
            check: {
              type: FILE_EXISTS,
              title: file.label,
              required: true,
              params: { path: stored, kind: stat.value.isDirectory ? 'folder' : 'file' },
            },
          });
        }
      }
      return ok(candidates);
    },
  };
}
