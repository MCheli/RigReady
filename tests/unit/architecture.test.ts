import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../helpers';

/** Rules about the shape of the code, checked on the source itself (ESLint enforces the same). */

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (/\.(ts|vue)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const src = path.join(repoRoot, 'src');
const relative = (file: string): string => path.relative(src, file).replace(/\\/g, '/');

describe('architecture', () => {
  it('only src/platform imports the file system, child processes or native bindings', async () => {
    const machine =
      /from\s+['"](?:node:)?(?:fs|fs\/promises|child_process)['"]|from\s+['"]koffi['"]|require\(['"](?:node:)?(?:fs|child_process)['"]\)/;
    const offenders: string[] = [];
    for (const file of await sourceFiles(src)) {
      const name = relative(file);
      if (name.startsWith('platform/') || name.startsWith('legacy/')) continue;
      if (machine.test(await fs.readFile(file, 'utf8'))) offenders.push(name);
    }
    // Everything else writes through FileStore (backup and journal first) and runs programs through Shell.
    expect(offenders).toEqual([]);
  });

  it('nothing runs a command through a shell', async () => {
    // exec( not preceded by a dot: RegExp.prototype.exec is fine, child_process.exec is not.
    const shell = /\bexecSync\b|(?<![.\w])exec\(|shell:\s*true/;
    const offenders: string[] = [];
    for (const file of await sourceFiles(src)) {
      const name = relative(file);
      if (name.startsWith('legacy/')) continue;
      if (shell.test(await fs.readFile(file, 'utf8'))) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it('features do not import each other, main or platform', async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(path.join(src, 'features'))) {
      const name = relative(file);
      const feature = name.split('/')[1]!;
      const text = await fs.readFile(file, 'utf8');
      for (const match of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const target = relative(path.resolve(path.dirname(file), match[1]!));
        const other = /^features\/([^/]+)\//.exec(target)?.[1];
        const crossesFeature = other !== undefined && other !== feature;
        if (crossesFeature || /^(main|platform|legacy)\//.test(target)) {
          offenders.push(`${name} -> ${target}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
