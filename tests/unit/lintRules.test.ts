/**
 * The architecture rules in eslint.config.mjs, proven to fire: each forbidden form is
 * linted as if it were a file in the place the rule guards (NFR-004, PLAT-008, PLAT-015).
 * A rule that silently stopped matching would otherwise look like clean code.
 */
import path from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';
import { repoRoot } from '../helpers';

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: repoRoot });
});

/** The messages ESLint gives for `code` as if it were the file `file` (relative to the repo). */
async function lint(file: string, code: string): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath: path.join(repoRoot, file) });
  return results.flatMap((r) => r.messages.map((m) => `${m.ruleId}: ${m.message}`));
}

const FEATURE = 'src/features/zz-example/core/thing.ts';

describe('lint: no shell command strings (NFR-004)', () => {
  it.each([
    ['exec', "import { exec } from 'node:child_process';\nexec('dir');\n"],
    ['execSync', "import cp from 'node:child_process';\ncp.execSync('dir');\n"],
    [
      'execFile',
      "import { execFile } from 'child_process';\nexecFile('cmd.exe', ['/c', 'dir']);\n",
    ],
    [
      'spawn with shell: true',
      "import { spawn } from 'node:child_process';\nspawn('dir', [], { shell: true });\n",
    ],
    [
      'spawn with a computed shell',
      "import { spawn } from 'node:child_process';\nexport const run = (s: boolean) => spawn('dir', [], { shell: s });\n",
    ],
  ])('%s is an error in src/platform too', async (_name, code) => {
    const messages = await lint('src/platform/node/zz-example.ts', code);
    expect(messages.some((m) => m.startsWith('no-restricted-syntax') && /NFR-004/.test(m))).toBe(
      true
    );
  });

  it('spawn without a shell, and RegExp.exec, are fine', async () => {
    const code = [
      "import { spawn } from 'node:child_process';",
      "export const child = spawn('x.exe', ['a'], { shell: false, windowsHide: true });",
      "export const found = /a/.exec('a');",
      '',
    ].join('\n');
    expect(await lint('src/platform/node/zz-example.ts', code)).toEqual([]);
  });
});

describe('lint: user paths only from KnownFolders (PLAT-008)', () => {
  it.each([
    ['os.homedir()', "import os from 'node:os';\nexport const home = os.homedir();\n"],
    ['os.tmpdir()', "import os from 'node:os';\nexport const temp = os.tmpdir();\n"],
    ["process.env['USERPROFILE']", "export const home = process.env['USERPROFILE'];\n"],
    ['process.env.APPDATA', 'export const roaming = process.env.APPDATA;\n'],
    ["process.env['LOCALAPPDATA']", "export const local = process.env['LOCALAPPDATA'];\n"],
    ["process.env['ProgramFiles(x86)']", "export const pf = process.env['ProgramFiles(x86)'];\n"],
    ["process.env['SystemRoot']", "export const windows = process.env['SystemRoot'];\n"],
    ['process.env.RIGREADY_HOME', 'export const data = process.env.RIGREADY_HOME;\n'],
  ])('%s is an error in a feature, in core, in main and in the fake platform', async (_n, code) => {
    for (const file of [
      FEATURE,
      'src/core/zz-example.ts',
      'src/main/zz-example.ts',
      'src/platform/fake/zz-example.ts',
      'src/platform/windows/zz-example.ts',
    ]) {
      const messages = await lint(file, code);
      expect(messages.some((m) => /PLAT-008/.test(m))).toBe(true);
    }
  });

  it('KnownFolders itself may read them, and other variables are not path reads', async () => {
    const code = "export const home = process.env['USERPROFILE'];\n";
    expect(await lint('src/platform/windows/knownFolders.ts', code)).toEqual([]);
    expect(
      await lint('src/main/zz-example.ts', "export const s = process.env['RIGREADY_SCENARIO'];\n")
    ).toEqual([]);
  });
});

describe('lint: features stay inside their folder (PLAT-015)', () => {
  it('a feature may not import main, platform, legacy, fs, child_process, koffi or electron', async () => {
    for (const source of [
      '../../../main/bootstrap',
      '../../../platform/fake',
      '../../../legacy/old',
      'node:fs',
      'fs/promises',
      'node:child_process',
      'koffi',
      'electron',
    ]) {
      const messages = await lint(FEATURE, `import * as x from '${source}';\nexport default x;\n`);
      expect(messages.some((m) => m.startsWith('no-restricted-imports'))).toBe(true);
    }
  });

  it('core may not import a feature, the platform, main or the renderer', async () => {
    for (const source of ['../features/fly/core/fly', '../platform/node', '../main/bootstrap']) {
      const messages = await lint(
        'src/core/zz-example.ts',
        `import * as x from '${source}';\nexport default x;\n`
      );
      expect(messages.some((m) => m.startsWith('no-restricted-imports'))).toBe(true);
    }
  });

  it('core, shared and its own files are allowed', async () => {
    const code = [
      "import { ok } from '../../../core/result';",
      "import { channel } from '../../../shared/ipc';",
      "import { helper } from './helper';",
      'export default [ok, channel, helper];',
      '',
    ].join('\n');
    expect(await lint(FEATURE, code)).toEqual([]);
  });
});
