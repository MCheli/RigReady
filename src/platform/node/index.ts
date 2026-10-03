import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Clock, LogSink, RawFs, Shell, ShellResult } from '../../core/ports';
import { err, ok, type Result } from '../../core/result';

/** Real implementations that are not Windows-specific. Shared by the windows and fake platforms. */

export const systemClock: Clock = { now: () => new Date() };

export class NodeRawFs implements RawFs {
  readText(file: string): Promise<string> {
    return fs.readFile(file, 'utf8');
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

export class NodeShell implements Shell {
  run(
    exe: string,
    args: string[],
    options: { cwd?: string; timeoutMs?: number } = {}
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
      try {
        const child = spawn(exe, args, {
          cwd: options.cwd,
          shell: false,
          windowsHide: true,
          timeout: options.timeoutMs ?? 30_000,
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
    options: { cwd?: string } = {}
  ): Promise<Result<{ pid: number | undefined }>> {
    return new Promise((resolve) => {
      try {
        const child = spawn(exe, args, {
          cwd: options.cwd ?? path.dirname(exe),
          shell: false,
          detached: true,
          stdio: 'ignore',
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
