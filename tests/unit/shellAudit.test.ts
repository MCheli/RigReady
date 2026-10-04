/**
 * NFR-004: nothing from a setup or an imported file ever becomes part of a command line.
 *
 * Three proofs:
 *   1. a scan of every shipped source file (src/, scripts/, the Python sidecar) for the ways
 *      a command string could be built or run;
 *   2. a setup whose program name and arguments are shell syntax reaches the Shell and
 *      process ports as the same literal values, and nothing else is started;
 *   3. the real Windows Shell hands those values, unchanged, to a real program, a real batch
 *      file (through cmd.exe) and a real PowerShell script.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Profile } from '../../src/core/profile/schema';
import { NodeShell, batchArgumentProblem, programStart } from '../../src/platform/node';
import { repoRoot, tempDir, wiredApp, type WiredApp } from '../helpers';

// ---- 1. the source scan -------------------------------------------------------------

async function filesUnder(dir: string, extensions: RegExp): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'legacy' || entry.name === 'node_modules') continue;
      out.push(...(await filesUnder(full, extensions)));
    } else if (extensions.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Comments say what the code must not do; only code is searched. */
function code(text: string, python: boolean): string {
  // Line breaks are kept, so a hit is reported at its real line.
  const blank = (found: string): string => found.replace(/[^\n]/g, '');
  if (python) return text.replace(/^\s*#.*$/gm, '').replace(/("""|''')[\s\S]*?\1/g, blank);
  return text
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/^\s*\/\/.*$/gm, '');
}

interface Rule {
  what: string;
  pattern: RegExp;
  /** Files (repo-relative, forward slashes) where the pattern is the reviewed exception. */
  allowed?: string[];
}

const SCRIPT_RULES: Rule[] = [
  {
    what: 'child_process.exec / execSync / execFile / execFileSync (a command line, or a shell option)',
    // exec( not preceded by a dot or a word character: RegExp.prototype.exec is fine.
    pattern: /\bexecSync\b|\bexecFileSync\b|\bexecFile\b|(?<![.\w])exec\(/,
  },
  {
    what: 'spawn with a shell',
    // `shell: Shell` (a type) and `shell: false` are fine; a value that can be true is not.
    pattern: /\bshell\s*:\s*(?:true\b|['"`]|process\.|!)/,
  },
  {
    what: 'a command line for cmd.exe (/c, /k)',
    pattern: /['"`]\/[ck]['"`]/i,
    // The one place a batch file is started: every argument is quoted and escaped there,
    // and the real-shell tests below prove it.
    allowed: ['src/platform/node/index.ts'],
  },
  {
    what: 'a PowerShell command string (-Command, -EncodedCommand, Invoke-Expression)',
    pattern: /['"`]-(?:Command|EncodedCommand|ec|enc)['"`]|\biex\b|Invoke-Expression/i,
  },
  {
    what: 'cmd.exe or powershell.exe started by name',
    pattern: /['"`](?:cmd\.exe|powershell(?:\.exe)?|pwsh(?:\.exe)?)['"`]|\bComSpec\b/i,
    allowed: ['src/platform/node/index.ts'],
  },
  { what: 'eval or new Function', pattern: /(?<![.\w])eval\(|new Function\(/ },
];

const PYTHON_RULES: Rule[] = [
  { what: 'shell=True', pattern: /shell\s*=\s*True/ },
  { what: 'os.system / os.popen', pattern: /\bos\.(system|popen|startfile|exec\w*|spawn\w*)\b/ },
  { what: 'subprocess', pattern: /\bsubprocess\b/ },
  { what: 'eval / exec', pattern: /(?<![.\w])(eval|exec)\(/ },
];

async function scan(files: string[], rules: Rule[], python = false): Promise<string[]> {
  const hits: string[] = [];
  for (const file of files) {
    const name = path.relative(repoRoot, file).replace(/\\/g, '/');
    const text = code(await fs.readFile(file, 'utf8'), python);
    for (const rule of rules) {
      if (rule.allowed?.includes(name)) continue;
      const lines = text.split('\n');
      lines.forEach((line, index) => {
        if (rule.pattern.test(line)) hits.push(`${name}:${index + 1}: ${rule.what}`);
      });
    }
  }
  return hits;
}

describe('NFR-004 source scan', () => {
  it('the scan itself catches each forbidden form and leaves ordinary code alone', async () => {
    const dir = await tempDir();
    try {
      const bad = [
        "import { exec } from 'node:child_process'; exec(`dir ${name}`);",
        "execSync('tasklist');",
        "execFile('cmd.exe', ['/c', line]);",
        'spawn(exe, args, { shell: true });',
        "spawn(exe, args, { shell: process.platform === 'win32' });",
        "spawn('cmd.exe', ['/c', `start ${exe}`]);",
        "spawn('powershell.exe', ['-Command', `Stop-Process ${name}`]);",
        'eval(text);',
      ];
      const good = [
        'const found = /x/.exec(text); regexp.exec(line);',
        'spawn(exe, args, { shell: false, windowsHide: true });',
        "shell.run(exe, ['-File', script]);",
        '// exec("never") in a comment',
      ];
      const badFile = path.join(dir.dir, 'bad.ts');
      const goodFile = path.join(dir.dir, 'good.ts');
      await fs.writeFile(badFile, bad.join('\n'));
      await fs.writeFile(goodFile, good.join('\n'));
      const hits = await scan([badFile], SCRIPT_RULES);
      for (let line = 1; line <= bad.length; line++) {
        expect(hits.some((h) => h.includes(`bad.ts:${line}:`))).toBe(true);
      }
      expect(await scan([goodFile], SCRIPT_RULES)).toEqual([]);

      const py = path.join(dir.dir, 'bad.py');
      await fs.writeFile(
        py,
        [
          'subprocess.run(cmd, shell=True)',
          'os.system("dir " + name)',
          '# os.system in a comment',
        ].join('\n')
      );
      const pyHits = await scan([py], PYTHON_RULES, true);
      expect(pyHits.some((h) => h.includes('bad.py:1:'))).toBe(true);
      expect(pyHits.some((h) => h.includes('bad.py:2:'))).toBe(true);
      expect(pyHits.some((h) => h.includes('bad.py:3:'))).toBe(false);
    } finally {
      await dir.cleanup();
    }
  });

  it('no shipped source builds or runs a shell command string (src, scripts, Python sidecar)', async () => {
    const scripts = [
      ...(await filesUnder(path.join(repoRoot, 'src'), /\.(ts|vue|mjs|js)$/)),
      ...(await filesUnder(path.join(repoRoot, 'scripts'), /\.(ts|mjs|js)$/)),
    ];
    const python = [
      ...(await filesUnder(path.join(repoRoot, 'python'), /\.py$/)),
      ...(await filesUnder(path.join(repoRoot, 'src'), /\.py$/)),
    ];
    // An empty file list would prove nothing.
    expect(scripts.length).toBeGreaterThan(200);
    expect(python.length).toBeGreaterThan(0);
    expect(await scan(scripts, SCRIPT_RULES)).toEqual([]);
    expect(await scan(python, PYTHON_RULES, true)).toEqual([]);
  });

  it('child_process is imported only by src/platform, and only for spawn', async () => {
    const files = await filesUnder(path.join(repoRoot, 'src'), /\.(ts|vue)$/);
    const importers: string[] = [];
    for (const file of files) {
      const text = await fs.readFile(file, 'utf8');
      for (const match of text.matchAll(
        /import\s+(?:type\s+)?([^;]*?)\s+from\s+['"](?:node:)?child_process['"]/g
      )) {
        const name = path.relative(repoRoot, file).replace(/\\/g, '/');
        importers.push(name);
        expect(name.startsWith('src/platform/')).toBe(true);
        const names = match[1]!
          .replace(/[{}]/g, '')
          .split(',')
          .map((n) => n.replace(/\btype\b/, '').trim())
          .filter(Boolean);
        for (const imported of names) {
          expect(['spawn', 'ChildProcess', 'SpawnOptions', 'SpawnOptionsWithoutStdio']).toContain(
            imported
          );
        }
      }
    }
    expect(importers.length).toBeGreaterThan(0);
  });
});

// ---- 2. a hostile setup on the fake Shell ---------------------------------------------

const HOSTILE_NAME = 'x & calc.exe';
const HOSTILE_ARGS = ['$(whoami)', '; del /q *', '`id`', '| calc.exe', '%COMSPEC%', '"&calc"'];

describe('NFR-004 a setup made of shell syntax', () => {
  let app: WiredApp;
  afterEach(() => app?.cleanup());

  it("process name 'x & calc.exe' and argument '$(whoami)' reach the fake Shell literally and nothing else is spawned", async () => {
    app = await wiredApp('generic-fresh', { files: [] });
    const exe = `C:\\Tools\\${HOSTILE_NAME}`;
    const script = path.join(app.home, 'Documents', 'x & calc.cmd');
    await fs.mkdir(path.dirname(script), { recursive: true });
    await fs.writeFile(script, '');
    const profile: Profile = {
      schemaVersion: 1,
      id: 'hostile',
      name: 'a"; & calc.exe $(whoami)',
      createdAt: '2026-10-03T12:00:00.000Z',
      updatedAt: '2026-10-03T12:00:00.000Z',
      extensions: {},
      launch: { exe, args: HOSTILE_ARGS },
      checks: [
        {
          id: 'app',
          type: 'process.running',
          title: HOSTILE_NAME,
          required: true,
          params: { name: HOSTILE_NAME },
          remediation: {
            type: 'process.launch',
            params: { exe, args: HOSTILE_ARGS, timeoutMs: 0 },
          },
        },
        {
          id: 'script',
          type: 'script.check',
          title: 'Script',
          required: false,
          params: { exe: script, args: HOSTILE_ARGS },
          remediation: {
            type: 'script.run',
            params: { exe: script, args: HOSTILE_ARGS, requiresConfirmation: false },
          },
        },
      ],
    };
    const saved = await app.wiring.context.profiles.save(profile);
    expect(saved.ok).toBe(true);
    const before = app.ports.state.processes.length;

    // The script check runs the script; the fix starts the program and runs the script again.
    await app.invoke('fly:makeReady', { profileId: 'hostile', approved: ['app', 'script'] });

    // The program was started once, with exactly the stored values.
    expect(app.ports.processes.started).toEqual([{ exe, args: HOSTILE_ARGS }]);
    // Exactly one process appeared, named as a whole: "calc.exe" was never a program of its own.
    const added = app.ports.state.processes.slice(before);
    expect(added.map((p) => p.name)).toEqual([HOSTILE_NAME]);
    expect(app.ports.state.processes.some((p) => p.name.toLowerCase() === 'calc.exe')).toBe(false);
    // Every Shell call is the script with the literal arguments: no interpreter in front,
    // no joined command line, and the setup's name only as an environment variable.
    expect(app.ports.shell.calls.length).toBeGreaterThan(0);
    for (const call of app.ports.shell.calls) {
      expect(call.exe).toBe(script);
      expect(call.args).toEqual(HOSTILE_ARGS);
      expect(call.options?.env?.['RIGREADY_PROFILE_NAME']).toBe(profile.name);
    }

    // Launch: the game is the same hostile program again.
    const launched = await app.invoke<{ outcome: string }>('fly:launch', { profileId: 'hostile' });
    expect(launched.outcome).toBe('launched');
    expect(app.ports.processes.started).toEqual([
      { exe, args: HOSTILE_ARGS },
      { exe, args: HOSTILE_ARGS },
    ]);
    expect(app.ports.state.processes.some((p) => p.name.toLowerCase() === 'calc.exe')).toBe(false);
  });
});

// ---- 3. the real Shell ----------------------------------------------------------------

/** Everything cmd.exe and PowerShell give a meaning to, in arguments a setup could hold. */
const LITERALS = [
  'plain',
  'two words',
  'x & calc.exe',
  '$(whoami)',
  'a | b',
  'a ^ b ^^ c',
  '%PATH%',
  '%COMSPEC:~0,3%',
  '%COMSPEC:~3%',
  '%COMSPEC:c=X%',
  '%COMSPEC:*\\=%',
  '%RIGREADY_TEST_AMP%',
  '%RIGREADY_TEST_AMP:x=y%',
  '%RIGREADY_PERCENT%',
  '%',
  '%%',
  '100%',
  '!PATH!',
  'a < b > c',
  '(paren) [bracket] {brace}',
  'semi;colon,comma=equals',
  '`backtick` $env:USERNAME',
  "single 'quoted'",
  'star * question ?',
  '&&',
  '||',
  '^',
  '@file',
  '-Name:value',
  'C:\\dir with space\\',
  '',
];

const windows = process.platform === 'win32';
const PRINT_ARGS =
  "require('fs').writeFileSync(process.env.RIGREADY_TEST_OUT, JSON.stringify(process.argv.slice(1)))";

describe.runIf(windows)('NFR-004 the real Windows Shell passes metacharacters literally', () => {
  let dir: string;
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });
  const fresh = async (): Promise<string> => {
    ({ dir, cleanup } = await tempDir());
    return dir;
  };
  const readArgs = async (file: string): Promise<string[]> =>
    JSON.parse(await fs.readFile(file, 'utf8')) as string[];

  it('a program receives every argument unchanged, a double quote and a line break included', async () => {
    const out = path.join(await fresh(), 'out.json');
    const args = [...LITERALS, 'say "hi" & calc', 'line\nbreak', 'trailing\\"'];
    const result = await new NodeShell().run(process.execPath, ['-e', PRINT_ARGS, ...args], {
      env: { RIGREADY_TEST_OUT: out },
    });
    expect(result).toMatchObject({ ok: true, value: { code: 0 } });
    expect(await readArgs(out)).toEqual(args);
  });

  it('a batch file (through cmd.exe) receives every argument unchanged and nothing in them runs', async () => {
    // The batch file's own folder and name hold metacharacters too.
    const folder = path.join(await fresh(), 'scripts & (more) %TEMP% ^x');
    await fs.mkdir(folder, { recursive: true });
    const out = path.join(folder, 'out.json');
    const canary = path.join(folder, 'canary.txt');
    const batch = path.join(folder, 'print & args.cmd');
    // %* hands the arguments on as cmd.exe received them.
    await fs.writeFile(batch, `@echo off\r\n"${process.execPath}" -e "${PRINT_ARGS}" %*\r\n`);
    const args = [
      ...LITERALS,
      // If any of these were read as a command, the canary file would appear.
      `& echo pwned> "${canary}".`.replace(/"/g, ''),
      `| echo pwned> ${canary}`,
      `&& echo pwned> ${canary}`,
      `%COMSPEC% /c echo pwned> ${canary}`,
    ];
    const result = await new NodeShell().run(batch, args, {
      // A variable whose value is a command: expanding it anywhere would run it.
      env: { RIGREADY_TEST_OUT: out, RIGREADY_TEST_AMP: `x & echo pwned> ${canary} & rem ` },
      timeoutMs: 30_000,
    });
    expect(result).toMatchObject({ ok: true, value: { code: 0, stderr: '' } });
    expect(await readArgs(out)).toEqual(args);
    await expect(fs.access(canary)).rejects.toThrow();
  });

  it('a batch file is refused an argument it cannot receive literally: a double quote or a line break', async () => {
    const folder = await fresh();
    const batch = path.join(folder, 'never.cmd');
    const canary = path.join(folder, 'canary.txt');
    await fs.writeFile(batch, `@echo ran> "${canary}"\r\n`);
    const shell = new NodeShell();
    for (const bad of ['" & calc.exe & "', 'a\nb', 'a\r\nb', 'a\rb']) {
      expect(batchArgumentProblem(batch, [bad])).toMatch(/double quote or a line break/);
      expect(await shell.run(batch, ['ok', bad])).toMatchObject({
        ok: false,
        error: { code: 'shell.argument' },
      });
      expect(await shell.launch(batch, [bad])).toMatchObject({
        ok: false,
        error: { code: 'shell.argument' },
      });
    }
    // Refused before anything was started.
    await expect(fs.access(canary)).rejects.toThrow();
    // A program takes them (first test); only batch files are restricted.
    expect(batchArgumentProblem('C:\\x\\tool.exe', ['a"b'])).toBeUndefined();
    expect(batchArgumentProblem('C:\\x\\tool.ps1', ['a"b'])).toBeUndefined();
  });

  it('the cmd.exe line escapes every metacharacter of the batch path and of each argument', () => {
    const start = programStart('C:\\a b\\x&y.cmd', ['a & b', '%PATH%'], { ComSpec: 'C:\\cmd.exe' });
    expect(start).toEqual({
      exe: 'C:\\cmd.exe',
      args: [
        '/d',
        '/v:off',
        '/s',
        '/c',
        '"C:\\a^ b\\x^&y.cmd ^"a^ ^&^ b^" ^"%__RIGREADY_PERCENT%PATH%__RIGREADY_PERCENT%^""',
      ],
      verbatim: true,
      // A percent sign is never written on the line: this variable stands for it, because
      // `^%NAME:a=b^%` would still be expanded (found by the batch-file test above).
      env: { __RIGREADY_PERCENT: '%' },
    });
    // A program is started directly, with the argument array as it is.
    expect(programStart('C:\\x\\tool.exe', ['a & b'])).toEqual({
      exe: 'C:\\x\\tool.exe',
      args: ['a & b'],
    });
  });

  it('a PowerShell script receives every argument unchanged and nothing in them is evaluated', async () => {
    const folder = path.join(await fresh(), 'ps & scripts');
    await fs.mkdir(folder, { recursive: true });
    const out = path.join(folder, 'out.json');
    const canary = path.join(folder, 'canary.txt');
    const script = path.join(folder, 'print args.ps1');
    await fs.writeFile(
      script,
      [
        '$list = @($args | ForEach-Object { [string]$_ })',
        "$json = \"[\" + (($list | ForEach-Object { '\"' + ($_ -replace '\\\\', '\\\\' -replace '\"', '\\\"') + '\"' }) -join \",\") + \"]\"",
        '[System.IO.File]::WriteAllText($env:RIGREADY_TEST_OUT, $json)',
      ].join('\r\n')
    );
    const args = [
      'plain',
      'two words',
      'x & calc.exe',
      '$(whoami)',
      `$(Set-Content -Path '${canary}' -Value pwned)`,
      `; Set-Content -Path '${canary}' -Value pwned`,
      `| Set-Content -Path '${canary}' -Value pwned`,
      '`backtick` $env:USERNAME',
      '%PATH%',
      'a | b',
      'a < b > c',
      "single 'quoted'",
      '@splat',
      '(paren) {brace}',
    ];
    const result = await new NodeShell().run(script, args, {
      env: { RIGREADY_TEST_OUT: out },
      timeoutMs: 60_000,
    });
    expect(result).toMatchObject({ ok: true, value: { code: 0 } });
    expect(await readArgs(out)).toEqual(args);
    await expect(fs.access(canary)).rejects.toThrow();
  });
});
