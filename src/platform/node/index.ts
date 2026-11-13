import { spawn, type SpawnOptions, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AppWindow,
  Clipboard,
  Clock,
  Dialogs,
  Hotkeys,
  Http,
  HttpRequest,
  HttpResponse,
  HttpStreamRequest,
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
  Shortcuts,
  Taskbar,
  UpdateFeed,
} from '../../core/ports';
import { LOG_KEEP_OLDER, LOG_MAX_BYTES } from '../../core/logger';
import { err, ok, type Result } from '../../core/result';

/** Real implementations that are not Windows-specific. Shared by the windows and fake platforms. */

export const systemClock: Clock = { now: () => new Date() };

/**
 * How long a write waits, in milliseconds, before each new try at putting its file in place.
 * Windows refuses to replace a file while anything has it open, for reading too: RigReady's own
 * page reading a file the moment it is written, a virus scanner, a backup tool. Such a hold
 * lasts a moment, so the write waits it out (about a second in all) before it gives up.
 */
const REPLACE_WAITS: readonly number[] = [5, 10, 20, 40, 80, 160, 320, 400];
/** What Windows answers while a file is held open by something else. */
const HELD = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * What is still to finish for each file RigReady is reading or writing, by its path: the
 * writes asked for so far, and everything asked for so far.
 *
 * A write of a file waits for RigReady's own earlier reads and writes of it, and a read waits
 * for the writes asked for before it. Reads do not wait for each other. Because:
 * - a read that has the file open makes Windows refuse the write that replaces it, and on a
 *   slow disk that lasted longer than the write waits (a session lost from the history);
 * - two writes of one file at once share the temporary file beside it, and what is left is
 *   part of one and part of the other, or one of them fails.
 * So only something outside RigReady can still be in a write's way, and the waits are for that.
 */
const turns = new Map<string, { writes: Promise<unknown>; all: Promise<unknown> }>();
const NOTHING = Promise.resolve();

function inTurn<T>(file: string, kind: 'read' | 'write', work: () => Promise<T>): Promise<T> {
  // Windows does not tell upper case from lower in a path.
  const key = path.resolve(file).toLowerCase();
  const before = turns.get(key) ?? { writes: NOTHING, all: NOTHING };
  const run = (kind === 'read' ? before.writes : before.all).then(work);
  // One that fails has failed for whoever asked; what comes after still gets its turn.
  const done = run.then(
    () => undefined,
    () => undefined
  );
  const now =
    kind === 'read'
      ? { writes: before.writes, all: Promise.all([before.all, done]) }
      : { writes: done, all: done };
  turns.set(key, now);
  void now.all.then(() => {
    if (turns.get(key) === now) turns.delete(key);
  });
  return run;
}

export class NodeRawFs implements RawFs {
  constructor(private readonly replaceWaits: readonly number[] = REPLACE_WAITS) {}

  readText(file: string): Promise<string> {
    return inTurn(file, 'read', () => fs.readFile(file, 'utf8'));
  }
  readBytes(file: string): Promise<Uint8Array> {
    return inTurn(file, 'read', async () => new Uint8Array(await fs.readFile(file)));
  }
  async stat(file: string): Promise<RawStat | undefined> {
    try {
      const stat = await fs.stat(file);
      return { isDirectory: stat.isDirectory(), size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      // The port says undefined for a path that is not there; one that cannot be looked at is treated the same, and reading it then fails with the real reason.
      return undefined;
    }
  }
  async removeDir(dir: string): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true });
  }
  async removeEmptyDir(dir: string): Promise<boolean> {
    try {
      // rmdir refuses a folder that holds anything; nothing is checked and then deleted.
      await fs.rmdir(dir);
      return true;
    } catch {
      // Not empty, or already gone: either way the folder is not ours to remove.
      return false;
    }
  }
  writeBytes(file: string, data: Uint8Array | string): Promise<void> {
    return inTurn(file, 'write', () => this.replace(file, data));
  }
  private async replace(file: string, data: Uint8Array | string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    // Write to a sibling and rename so a crash never leaves a half-written file.
    const temp = `${file}.rigready-tmp`;
    await fs.writeFile(temp, data);
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temp, file);
        return;
      } catch (e) {
        const wait = this.replaceWaits[attempt];
        if (wait === undefined || !HELD.has((e as NodeJS.ErrnoException).code ?? '')) {
          // The file stays as it was, and the half of this write that happened is taken away.
          await fs.rm(temp, { force: true }).catch(() => undefined);
          throw e;
        }
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
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
      // Not there.
      return false;
    }
  }
  async mkdirp(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }
  async list(dir: string): Promise<string[]> {
    try {
      return (await fs.readdir(dir)).sort();
    } catch (e) {
      // The port says a folder that does not exist is empty. One that exists and cannot be
      // listed (no access, not a folder) is an error: "empty" would be a wrong answer.
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
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

// Everything cmd.exe gives a meaning to, the percent sign aside (see cmdEscape).
const CMD_META = /([()\][!^"`<>&|;, *?])/g;

/**
 * The variable a percent sign is written as on a cmd.exe line. Its value is a percent
 * sign, set for that one cmd.exe (see programStart).
 */
export const CMD_PERCENT_VARIABLE = '__RIGREADY_PERCENT';

/**
 * Escapes text for a cmd.exe command line. A caret takes the meaning from every special
 * character but one: cmd.exe expands `%NAME%` before it looks at carets, and although
 * `^%NAME^%` stops a plain `%NAME%`, it does not stop the replacing form `%NAME:a=b%`,
 * which would put a variable's value (and any `&` in it) into the line. So a percent sign
 * is never written: `%__RIGREADY_PERCENT%` stands for it, and what a variable expands to
 * is not read again.
 */
function cmdEscape(text: string): string {
  return text.replace(CMD_META, '^$1').replace(/%/g, `%${CMD_PERCENT_VARIABLE}%`);
}

/** One argument, quoted and escaped so cmd.exe hands it to a batch file as one literal value. */
function cmdArgument(arg: string): string {
  // Backslashes before a quote, and at the end (before the closing quote), are doubled.
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
  return cmdEscape(quoted);
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
  /** Variables the started program must be given for the line to mean what it says. */
  env?: Record<string, string>;
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
    const line = [cmdEscape(exe), ...args.map(cmdArgument)].join(' ');
    return {
      exe: env['ComSpec'] ?? env['COMSPEC'] ?? 'cmd.exe',
      // /d: no AutoRun commands. /v:off: `!NAME!` is never expanded, whatever the registry says.
      args: ['/d', '/v:off', '/s', '/c', `"${line}"`],
      verbatim: true,
      env: { [CMD_PERCENT_VARIABLE]: '%' },
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

/** Starts a program that lives on by itself with no window at all (platform/windows/hiddenLaunch). */
export type HiddenLauncher = (
  start: ProgramStart,
  options: { cwd: string; env: NodeJS.ProcessEnv }
) => Result<{ pid: number | undefined }>;
/** The caller's options plus what the start itself needs in the environment. */
function withStartEnv<T extends ShellOptions>(options: T, start: ProgramStart): T {
  return start.env ? { ...options, env: { ...options.env, ...start.env } } : options;
}

export class NodeShell implements Shell {
  /**
   * @param hiddenLauncher How launch() starts a hidden program. Node's own detached start
   * leaves a batch file without a console, so the console programs it runs open windows.
   */
  constructor(private readonly hiddenLauncher?: HiddenLauncher) {}

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
          ...runSpawnOptions(withStartEnv(options, start)),
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
        if (options.hidden && this.hiddenLauncher) {
          return resolve(
            this.hiddenLauncher(start, {
              cwd: options.cwd ?? path.dirname(exe),
              env: { ...process.env, ...options.env, ...start.env },
            })
          );
        }
        const child = spawn(start.exe, start.args, {
          ...launchSpawnOptions(exe, withStartEnv(options, start)),
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

/** Names of this PC itself: plain http is allowed to them (local AI servers such as Ollama). */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https anywhere, or plain http to this PC only. */
export const allowedUrl = (url: URL): boolean =>
  url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));

/**
 * fetch, restricted to https (plain http only to this PC). Used by the real platform; tests
 * use the scripted fake. With `noRedirects` a redirect is returned as it is, never followed.
 */
export class NodeHttp implements Http {
  async request(request: HttpRequest): Promise<Result<HttpResponse>> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return err('http.url', `Not a valid address: ${request.url}`);
    }
    if (!allowedUrl(url)) return err('http.url', 'Only https addresses are allowed.');
    try {
      const response = await fetch(url, {
        method: request.method ?? 'GET',
        ...(request.headers ? { headers: request.headers } : {}),
        ...(request.body !== undefined ? { body: request.body } : {}),
        signal: AbortSignal.timeout(request.timeoutMs ?? 60_000),
        ...(request.noRedirects ? { redirect: 'manual' as const } : {}),
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

  async stream(
    request: HttpStreamRequest,
    onChunk: (bytes: Uint8Array) => void
  ): Promise<Result<HttpResponse>> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return err('http.url', `Not a valid address: ${request.url}`);
    }
    if (!allowedUrl(url)) return err('http.url', 'Only https addresses are allowed.');
    if (request.signal?.aborted) return err('http.cancelled', 'The request was cancelled.');

    // One controller ends the fetch and the body read, whatever the reason; `why` keeps the first.
    const controller = new AbortController();
    let why: 'idle' | 'timeout' | 'cancelled' | undefined;
    const stop = (reason: 'idle' | 'timeout' | 'cancelled'): void => {
      why ??= reason;
      controller.abort();
    };
    const idleMs = request.idleTimeoutMs ?? 60_000;
    let idle = setTimeout(() => stop('idle'), idleMs);
    const total =
      request.timeoutMs === undefined
        ? undefined
        : setTimeout(() => stop('timeout'), request.timeoutMs);
    const cancelled = (): void => stop('cancelled');
    request.signal?.addEventListener('abort', cancelled, { once: true });
    try {
      const response = await fetch(url, {
        method: request.method ?? 'GET',
        ...(request.headers ? { headers: request.headers } : {}),
        ...(request.body !== undefined ? { body: request.body } : {}),
        signal: controller.signal,
        ...(request.noRedirects ? { redirect: 'manual' as const } : {}),
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => (headers[key.toLowerCase()] = value));
      if (!response.ok || !response.body) {
        return ok({ status: response.status, headers, body: await response.text() });
      }
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(idle);
        idle = setTimeout(() => stop('idle'), idleMs);
        if (value.length > 0) onChunk(value);
      }
      return ok({ status: response.status, headers, body: '' });
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      if (why === 'cancelled') return err('http.cancelled', 'The request was cancelled.');
      if (why === 'idle') {
        return err(
          'http.idle',
          `${url.host} sent nothing for ${Math.round(idleMs / 1000)} seconds.`,
          detail
        );
      }
      if (why === 'timeout') return err('http.timeout', `${url.host} took too long.`, detail);
      return err('http.network', `Could not reach ${url.host}.`, detail);
    } finally {
      clearTimeout(idle);
      clearTimeout(total);
      request.signal?.removeEventListener('abort', cancelled);
    }
  }
}

/**
 * For scenario runs that test against a server the test itself started on this PC: requests
 * to this PC go to the real network, everything else to the scripted port. Only used when
 * RIGREADY_SCENARIO_LOOPBACK=1 is set for a scenario run.
 */
export class LoopbackHttp implements Http {
  private readonly real = new NodeHttp();
  constructor(private readonly scripted: Http) {}

  private local(url: string): boolean {
    try {
      return LOOPBACK.has(new URL(url).hostname);
    } catch {
      // Not a URL: the scripted port refuses it like any other unscripted request.
      return false;
    }
  }

  request(request: HttpRequest): Promise<Result<HttpResponse>> {
    return this.local(request.url) ? this.real.request(request) : this.scripted.request(request);
  }

  stream(
    request: HttpStreamRequest,
    onChunk: (bytes: Uint8Array) => void
  ): Promise<Result<HttpResponse>> {
    return this.local(request.url)
      ? this.real.stream(request, onChunk)
      : this.scripted.stream(request, onChunk);
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
  clipboard: Clipboard;
  loginItem: LoginItem;
  overlays: Overlays;
  window: AppWindow;
  updates: UpdateFeed;
  shortcuts: Shortcuts;
  taskbar: Taskbar;
  hotkeys: Hotkeys;
} = {
  hotkeys: {
    register: async () => unavailable('A system-wide hotkey'),
    unregister: async () => unavailable('A system-wide hotkey'),
    registered: async () => unavailable('A system-wide hotkey'),
    // Nothing presses a hotkey outside the app.
    subscribe: () => () => {},
  },
  taskbar: {
    setJumpTasks: async () => unavailable('The Jump List'),
    setOverlay: async () => unavailable('The taskbar button'),
    setTooltip: async () => unavailable('The taskbar button'),
    setProgress: async () => unavailable('The taskbar button'),
    setButtons: async () => unavailable('The taskbar button'),
    // Nothing presses a button outside the app.
    subscribe: () => () => {},
  },
  shortcuts: {
    self: () => ({ exe: process.execPath, args: [], icon: process.execPath }),
    build: async () => unavailable('Making a shortcut'),
    read: async () => unavailable('Reading a shortcut'),
  },
  updates: {
    currentVersion: () => '0.0.0',
    unavailable: () => 'Updates are only available inside the RigReady app.',
    check: async () => unavailable('Updating'),
    download: async () => unavailable('Updating'),
    setInstallOnQuit: () => {},
    quitAndInstall: async () => unavailable('Updating'),
  },
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
  clipboard: { writeText: async () => unavailable('The clipboard') },
  loginItem: {
    isEnabled: async () => unavailable('Start with Windows'),
    setEnabled: async () => unavailable('Start with Windows'),
  },
  overlays: {
    showLabels: async () => unavailable('Screen labels'),
    showPanel: async () => unavailable('The overlay'),
    panelPlace: async () => unavailable('The overlay'),
    hidePanel: async () => unavailable('The overlay'),
  },
  // No window to move outside the app; a layout change from a script needs none.
  window: {
    showOn: async () => ok({ moved: false }),
    openPanel: async () => unavailable('Extra windows'),
    openLink: async () => unavailable('Opening links'),
  },
};

/**
 * Appends to a log file without blocking the caller; rotates at maxBytes keeping `keep`
 * older files (rigready.log.1 is the newest of them). By default 5 MB and four older
 * files: five files, 25 MB at most.
 */
export class RotatingFileSink implements LogSink {
  private tail: Promise<void> = Promise.resolve();
  private written: number | undefined;
  /** Lines that could not be written (disk full, folder not writable). Logging never throws. */
  dropped = 0;

  constructor(
    private readonly file: string,
    private readonly maxBytes = LOG_MAX_BYTES,
    private readonly keep = LOG_KEEP_OLDER
  ) {}

  write(line: string): void {
    // Writes are chained so lines stay in order; a failed write never breaks the chain.
    this.tail = this.tail
      .then(() => this.append(line))
      .catch(() => {
        // Nowhere to report it but here: the log is where failures are reported.
        this.dropped++;
        this.written = undefined;
      });
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
      // A missing older file is normal (the log has not rotated that often yet).
      const quiet = (): void => {};
      await fs.rm(`${this.file}.${this.keep}`, { force: true }).catch(quiet);
      for (let i = this.keep - 1; i >= 1; i--) {
        await fs.rename(`${this.file}.${i}`, `${this.file}.${i + 1}`).catch(quiet);
      }
      if (this.keep >= 1) await fs.rename(this.file, `${this.file}.1`).catch(quiet);
      else await fs.rm(this.file, { force: true }).catch(quiet);
      this.written = await fs.stat(this.file).then(
        (s) => s.size,
        () => 0
      );
    }
    await fs.appendFile(this.file, line, 'utf8');
    this.written += size;
  }
}
