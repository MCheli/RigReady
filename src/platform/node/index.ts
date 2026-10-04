import { spawn, type SpawnOptions, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AppWindow,
  Clock,
  Dialogs,
  Http,
  HttpRequest,
  HttpResponse,
  LogSink,
  LoginItem,
  Notifications,
  Overlays,
  RawFs,
  RawStat,
  Render,
  Secrets,
  Shell,
  ShellOptions,
  ShellResult,
} from '../../core/ports';
import { err, ok, type Result } from '../../core/result';

/** Real implementations that are not Windows-specific. Shared by the windows and fake platforms. */

export const systemClock: Clock = { now: () => new Date() };

export class NodeRawFs implements RawFs {
  readText(file: string): Promise<string> {
    return fs.readFile(file, 'utf8');
  }
  async readBytes(file: string): Promise<Uint8Array> {
    return new Uint8Array(await fs.readFile(file));
  }
  async stat(file: string): Promise<RawStat | undefined> {
    try {
      const stat = await fs.stat(file);
      return { isDirectory: stat.isDirectory(), size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      return undefined;
    }
  }
  async removeDir(dir: string): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true });
  }
  async writeBytes(file: string, data: Uint8Array | string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Write to a sibling and rename so a crash never leaves a half-written file.
    const temp = `${file}.rigready-tmp`;
    await fs.writeFile(temp, data);
    await fs.rename(temp, file);
  }
  async appendText(file: string, text: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, text, 'utf8');
  }
  async exists(file: string): Promise<boolean> {
    try {
      await fs.access(file);
      return true;
    } catch {
      return false;
    }
  }
  async mkdirp(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }
  async list(dir: string): Promise<string[]> {
    try {
      return (await fs.readdir(dir)).sort();
    } catch {
      return [];
    }
  }
  async copyFile(from: string, to: string): Promise<void> {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  }
  async remove(file: string): Promise<void> {
    await fs.rm(file, { force: true });
  }
}

// Everything cmd.exe gives a meaning to.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** One argument, quoted and escaped so cmd.exe hands it to a batch file as one literal value. */
function cmdArgument(arg: string): string {
  // Backslashes before a quote, and at the end (before the closing quote), are doubled.
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
  return quoted.replace(CMD_META, '^$1');
}

/**
 * A batch file reads its arguments a second time when it uses them (`%1`, `%*`), and a
 * double quote inside an argument would end the quoting there. Such an argument is
 * refused rather than risked. Programs and PowerShell scripts take any argument.
 */
export function batchArgumentProblem(exe: string, args: string[]): string | undefined {
  const extension = path.extname(exe).toLowerCase();
  if (extension !== '.cmd' && extension !== '.bat') return undefined;
  const bad = args.find((arg) => /["\r\n]/.test(arg));
  return bad === undefined
    ? undefined
    : `A batch file cannot be given an argument that contains a double quote or a line break (${JSON.stringify(bad)}). Use a PowerShell script or a program for this.`;
}

export interface ProgramStart {
  exe: string;
  args: string[];
  /** The arguments are already one finished command line for cmd.exe. */
  verbatim?: true;
}

/**
 * What to start for a program or script. Windows starts only real programs directly: a
 * batch file needs cmd.exe and a PowerShell script needs powershell.exe. The caller still
 * gives an executable and an argument array; the quoting for cmd.exe is done here, in one
 * place, so that no argument can ever be read as part of a command (`a & del x` stays
 * one argument).
 */
export function programStart(
  exe: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env
): ProgramStart {
  const extension = path.extname(exe).toLowerCase();
  if (extension === '.cmd' || extension === '.bat') {
    const line = [exe.replace(CMD_META, '^$1'), ...args.map(cmdArgument)].join(' ');
    return {
      exe: env['ComSpec'] ?? env['COMSPEC'] ?? 'cmd.exe',
      args: ['/d', '/s', '/c', `"${line}"`],
      verbatim: true,
    };
  }
  if (extension === '.ps1') {
    return {
      exe: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', exe, ...args],
    };
  }
  return { exe, args };
}

/** The spawn options of Shell.run: never a shell, hidden unless asked otherwise. */
export function runSpawnOptions(
  options: ShellOptions & { timeoutMs?: number } = {},
  baseEnv: NodeJS.ProcessEnv = process.env
): SpawnOptionsWithoutStdio {
  return {
    cwd: options.cwd,
    shell: false,
    windowsHide: options.hidden ?? true,
    timeout: options.timeoutMs ?? 30_000,
    ...(options.env ? { env: { ...baseEnv, ...options.env } } : {}),
  };
}

/** The spawn options of Shell.launch: detached, with its own window unless hidden. */
export function launchSpawnOptions(
  exe: string,
  options: ShellOptions = {},
  baseEnv: NodeJS.ProcessEnv = process.env
): SpawnOptions {
  return {
    cwd: options.cwd ?? path.dirname(exe),
    shell: false,
    detached: true,
    stdio: 'ignore',
    windowsHide: options.hidden ?? false,
    ...(options.env ? { env: { ...baseEnv, ...options.env } } : {}),
  };
}

export class NodeShell implements Shell {
  run(
    exe: string,
    args: string[],
    options: ShellOptions & { timeoutMs?: number } = {}
  ): Promise<Result<ShellResult>> {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (result: Result<ShellResult>): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const problem = batchArgumentProblem(exe, args);
      if (problem) return finish(err('shell.argument', `Could not start ${exe}.`, problem));
      try {
        const start = programStart(exe, args);
        const child = spawn(start.exe, start.args, {
          ...runSpawnOptions(options),
          ...(start.verbatim ? { windowsVerbatimArguments: true } : {}),
        });
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        child.on('error', (e) => finish(err('shell.spawn', `Could not start ${exe}.`, e.message)));
        child.on('close', (code) => finish(ok({ code, stdout, stderr })));
      } catch (e) {
        finish(err('shell.spawn', `Could not start ${exe}.`, String(e)));
      }
    });
  }

  launch(
    exe: string,
    args: string[],
    options: ShellOptions = {}
  ): Promise<Result<{ pid: number | undefined }>> {
    return new Promise((resolve) => {
      const problem = batchArgumentProblem(exe, args);
      if (problem) return resolve(err('shell.argument', `Could not start ${exe}.`, problem));
      try {
        const start = programStart(exe, args);
        const child = spawn(start.exe, start.args, {
          ...launchSpawnOptions(exe, options),
          ...(start.verbatim ? { windowsVerbatimArguments: true } : {}),
        });
        child.once('error', (e) =>
          resolve(err('shell.launch', `Could not start ${exe}.`, e.message))
        );
        child.once('spawn', () => {
          child.unref();
          resolve(ok({ pid: child.pid }));
        });
      } catch (e) {
        resolve(err('shell.launch', `Could not start ${exe}.`, String(e)));
      }
    });
  }
}

/** fetch, restricted to https. Used by the real platform; tests use the scripted fake. */
export class NodeHttp implements Http {
  async request(request: HttpRequest): Promise<Result<HttpResponse>> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return err('http.url', `Not a valid address: ${request.url}`);
    }
    if (url.protocol !== 'https:') return err('http.url', 'Only https addresses are allowed.');
    try {
      const response = await fetch(url, {
        method: request.method ?? 'GET',
        ...(request.headers ? { headers: request.headers } : {}),
        ...(request.body !== undefined ? { body: request.body } : {}),
        signal: AbortSignal.timeout(request.timeoutMs ?? 60_000),
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => (headers[key.toLowerCase()] = value));
      return ok({ status: response.status, headers, body: await response.text() });
    } catch (e) {
      const timedOut = e instanceof Error && e.name === 'TimeoutError';
      return err(
        timedOut ? 'http.timeout' : 'http.network',
        timedOut ? `${url.host} did not answer in time.` : `Could not reach ${url.host}.`,
        e instanceof Error ? e.message : String(e)
      );
    }
  }
}

const unavailable = (what: string): Result<never> =>
  err('port.unavailable', `${what} is only available inside the RigReady app.`);

/**
 * Stand-ins for the ports that need Electron, used when the platform is created
 * outside the app (scripts, rig smoke tests). They fail clearly instead of pretending.
 */
export const headlessPorts: {
  secrets: Secrets;
  dialogs: Dialogs;
  render: Render;
  notifications: Notifications;
  loginItem: LoginItem;
  overlays: Overlays;
  window: AppWindow;
} = {
  secrets: {
    get: async () => unavailable('The secret store'),
    set: async () => unavailable('The secret store'),
    remove: async () => unavailable('The secret store'),
  },
  dialogs: {
    open: async () => unavailable('The file picker'),
    save: async () => unavailable('The file picker'),
  },
  render: {
    png: async () => unavailable('Rendering'),
    pdf: async () => unavailable('Rendering'),
  },
  notifications: { notify: async () => unavailable('Notifications') },
  loginItem: {
    isEnabled: async () => unavailable('Start with Windows'),
    setEnabled: async () => unavailable('Start with Windows'),
  },
  overlays: { showLabels: async () => unavailable('Screen labels') },
  // No window to move outside the app; a layout change from a script needs none.
  window: {
    showOn: async () => ok({ moved: false }),
    openPanel: async () => unavailable('Extra windows'),
  },
};

/** Appends to a log file without blocking the caller; rotates at maxBytes keeping `keep` older files. */
export class RotatingFileSink implements LogSink {
  private tail: Promise<void> = Promise.resolve();
  private written: number | undefined;

  constructor(
    private readonly file: string,
    private readonly maxBytes = 1_000_000,
    private readonly keep = 3
  ) {}

  write(line: string): void {
    // Writes are chained so lines stay in order; a failed write never breaks the chain.
    this.tail = this.tail.then(() => this.append(line)).catch(() => {});
  }

  /** Resolves when everything written so far is on disk. */
  close(): Promise<void> {
    return this.tail;
  }

  private async append(line: string): Promise<void> {
    if (this.written === undefined) {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      this.written = await fs.stat(this.file).then(
        (s) => s.size,
        () => 0
      );
    }
    const size = Buffer.byteLength(line);
    if (this.written > 0 && this.written + size > this.maxBytes) {
      for (let i = this.keep - 1; i >= 1; i--) {
        await fs.rename(`${this.file}.${i}`, `${this.file}.${i + 1}`).catch(() => {});
      }
      await fs.rename(this.file, `${this.file}.1`).catch(() => {});
      this.written = 0;
    }
    await fs.appendFile(this.file, line, 'utf8');
    this.written += size;
  }
}
