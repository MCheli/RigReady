import path from 'node:path';

import { collapsePath, type PathVariables } from '../../../core/pathVariables';
import type { FileStore, KnownFolders, Registry } from '../../../core/ports';
import { ok, type Result } from '../../../core/result';
import type { RegistryHive } from '../../../shared/models';
import { type FindProgramsInput, type FoundProgram, type FoundPrograms } from './assistantModel';

/**
 * "Where is SimAppPro?" Finds the programs of helper tools on this PC by name or vendor, for
 * an assistant building a ready check. Only reads: the folder names under Program Files,
 * Program Files (x86), LocalAppData\Programs and the Steam libraries, and the uninstall
 * entries of the registry. Paths come back in stored form, with path variables applied
 * ({PROGRAM_FILES_X86}/TrackIR5/TrackIR5.exe), the way a setup keeps them.
 */

/**
 * Other words the common helpers go by: the folder or vendor a search for the usual name
 * would not find on its own. Keyed by the normalized name.
 */
const ALSO: Record<string, string[]> = {
  srs: ['SimpleRadio', 'SR-ClientRadio'],
  simpleradio: ['SR-ClientRadio'],
  trackir: ['NaturalPoint'],
  streamdeck: ['Elgato'],
  pithouse: ['MOZA'],
  moza: ['Pit House'],
  ghub: ['LGHUB', 'Logitech'],
  logitechghub: ['LGHUB'],
  simapppro: ['WINWING'],
  winwing: ['SimAppPro'],
  openkneeboard: ['Kneeboard'],
  voiceattack: ['VoiceAttack'],
  tacview: ['Tacview'],
  simhub: ['SimHub'],
  crewchief: ['CrewChief'],
  vaicom: ['VAICOM'],
  jetseat: ['KW-908', 'SimShaker'],
  simshaker: ['SimShaker'],
};

/** Programs that come with a tool but are not the tool. */
const NOT_THE_PROGRAM =
  /^(unins\d*|uninstall.*|.*crashpad.*|.*crash_?report.*|vc_?redist.*|dotnet.*|.*setup|.*installer|qtwebengineprocess|cefsharp\..*)\.exe$/i;

const UNINSTALL: [RegistryHive, string][] = [
  ['HKLM', 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
  ['HKLM', 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
  ['HKCU', 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall'],
];

/** How far below a matching folder exes are looked for. */
const DEPTH = 3;
/** At most this many folders are listed in one search, so a huge disk cannot stall it. */
const MAX_FOLDERS = 4000;
const MAX_RESULTS = 60;

export const normalize = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');

export interface FinderPorts {
  files: Pick<FileStore, 'listEntries' | 'exists'>;
  registry: Registry;
  folders: Pick<
    KnownFolders,
    'programFiles' | 'programFilesX86' | 'localAppData' | 'steamLibraries'
  >;
}

interface Term {
  asked: string;
  words: string[];
}

function termsOf(names: string[]): Term[] {
  return names.map((asked) => {
    const base = normalize(asked.replace(/\.exe$/i, ''));
    const words = new Set([base]);
    for (const extra of ALSO[base] ?? []) words.add(normalize(extra));
    return { asked, words: [...words].filter((w) => w.length >= 2) };
  });
}

const matches = (name: string, term: Term): boolean => {
  const n = normalize(name.replace(/\.exe$/i, ''));
  return term.words.some((w) => n.includes(w));
};

/** The path a DisplayIcon value names: `"C:\x\y.exe",0` -> `C:\x\y.exe`. */
export function iconPath(value: string): string | undefined {
  const trimmed = value
    .trim()
    .replace(/,\s*-?\d+$/, '')
    .replace(/^"|"$/g, '')
    .trim();
  return /\.exe$/i.test(trimmed) && path.win32.isAbsolute(trimmed) ? trimmed : undefined;
}

export async function findPrograms(
  ports: FinderPorts,
  variables: PathVariables,
  input: FindProgramsInput
): Promise<Result<FoundPrograms>> {
  const terms = termsOf(input.names);
  const found = new Map<string, FoundProgram>();
  let folders = 0;
  let truncated = false;

  const add = (
    absolute: string,
    where: string,
    term: Term,
    extra: Partial<FoundProgram> = {}
  ): void => {
    const exe = path.win32.basename(absolute);
    if (NOT_THE_PROGRAM.test(exe)) return;
    const key = path.win32.normalize(absolute).toLowerCase();
    const existing = found.get(key);
    if (existing) {
      found.set(key, { ...existing, ...extra, where: existing.where });
      return;
    }
    if (found.size >= MAX_RESULTS) {
      truncated = true;
      return;
    }
    found.set(key, {
      exe,
      path: collapsePath(absolute, variables),
      where,
      matched: term.asked,
      likely: matches(exe, term),
      ...extra,
    });
  };

  const list = async (dir: string) => {
    if (folders >= MAX_FOLDERS) {
      truncated = true;
      return [];
    }
    folders += 1;
    const entries = await ports.files.listEntries(dir);
    return entries.ok ? entries.value : [];
  };

  /** Every exe in a folder that matched, down to DEPTH levels. */
  const collect = async (dir: string, where: string, term: Term, depth: number) => {
    for (const entry of await list(dir)) {
      if (entry.isDirectory) {
        if (depth > 0) await collect(entry.path, where, term, depth - 1);
      } else if (/\.exe$/i.test(entry.name)) {
        add(entry.path, where, term);
      }
    }
  };

  const roots: { dir: string; where: string }[] = [
    { dir: ports.folders.programFiles(), where: 'Program Files' },
    { dir: ports.folders.programFilesX86(), where: 'Program Files (x86)' },
    { dir: path.join(ports.folders.localAppData(), 'Programs'), where: 'LocalAppData\\Programs' },
  ];
  const libraries = await ports.folders.steamLibraries();
  if (libraries.ok) {
    for (const library of libraries.value) {
      roots.push({ dir: path.join(library, 'steamapps', 'common'), where: 'Steam library' });
    }
  }

  for (const root of roots) {
    const top = (await list(root.dir)).filter((e) => e.isDirectory);
    for (const first of top) {
      const term = terms.find((t) => matches(first.name, t));
      if (term) {
        await collect(first.path, root.where, term, DEPTH);
        continue;
      }
      // A vendor folder: "NaturalPoint\TrackIR5", "Eagle Dynamics\DCS World".
      for (const second of (await list(first.path)).filter((e) => e.isDirectory)) {
        const inner = terms.find((t) => matches(second.name, t));
        if (inner) await collect(second.path, root.where, inner, DEPTH - 1);
      }
    }
  }

  for (const [hive, key] of UNINSTALL) {
    const keys = await ports.registry.listKeys(hive, key);
    if (!keys.ok) continue;
    for (const sub of keys.value) {
      const values = await ports.registry.listValues(hive, `${key}\\${sub}`);
      if (!values.ok) continue;
      const text = (name: string): string | undefined => {
        const value = values.value[name];
        return value?.type === 'string' && value.value.trim() ? value.value.trim() : undefined;
      };
      const product = text('DisplayName');
      const publisher = text('Publisher');
      const term = terms.find(
        (t) => (product && matches(product, t)) || (publisher && matches(publisher, t))
      );
      if (!term) continue;
      const where = `Uninstall entry: ${product ?? sub}`;
      const extra: Partial<FoundProgram> = {
        ...(product ? { product } : {}),
        ...(publisher ? { publisher } : {}),
        ...(text('DisplayVersion') ? { version: text('DisplayVersion')! } : {}),
      };
      const icon = iconPath(text('DisplayIcon') ?? '');
      if (icon && (await ports.files.exists(icon))) add(icon, where, term, extra);
      const location = text('InstallLocation');
      if (location && path.win32.isAbsolute(location)) {
        const before = new Set(found.keys());
        await collect(location, where, term, 1);
        for (const [k, v] of found) if (!before.has(k)) found.set(k, { ...v, ...extra });
      }
    }
  }

  const programs = [...found.values()].sort(
    (a, b) =>
      Number(b.likely) - Number(a.likely) ||
      a.matched.localeCompare(b.matched) ||
      a.path.length - b.path.length
  );
  const notFound = terms
    .filter((t) => !programs.some((p) => p.matched === t.asked))
    .map((t) => t.asked);
  return ok({
    programs,
    searched: roots.map((r) => collapsePath(r.dir, variables)),
    notFound,
    truncated,
  });
}
