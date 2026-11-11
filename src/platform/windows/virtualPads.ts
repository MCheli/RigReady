import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { z } from 'zod';
import type { Logger } from '../../core/logger';
import type { VirtualPads } from '../../core/ports';
import { err, ok, type Result } from '../../core/result';
import {
  VirtualPadKindSchema,
  type PadReport,
  type VirtualPadKind,
  type VirtualPadStatus,
} from '../../shared/models';

/**
 * The virtual controller through a second Python helper (python/pad_server.py) that talks
 * to the ViGEmBus driver through ViGEmClient.dll. The helper speaks newline-delimited JSON
 * on stdin/stdout like the input reader. It is started when a controller is plugged in and
 * ends when it is unplugged; when RigReady ends in any way its stdin closes, the helper
 * unplugs the controller and exits, and the driver removes a controller whose program ended.
 */

export interface PadHelperLocation {
  python: string;
  script: string;
  client: string;
}

/**
 * Packaged: <resources>/python/python.exe, <resources>/sidecar/pad_server.py and
 * <resources>/vigem/ViGEmClient.dll. Development: resources/python, python/ and
 * resources/vigem (created by `npm run setup:python`).
 */
export function locatePadHelper(options: {
  resourcesPath?: string;
  projectRoot: string;
}): Result<PadHelperLocation> {
  const candidates: PadHelperLocation[] = [];
  if (options.resourcesPath) {
    candidates.push({
      python: path.join(options.resourcesPath, 'python', 'python.exe'),
      script: path.join(options.resourcesPath, 'sidecar', 'pad_server.py'),
      client: path.join(options.resourcesPath, 'vigem', 'ViGEmClient.dll'),
    });
  }
  candidates.push({
    python: path.join(options.projectRoot, 'resources', 'python', 'python.exe'),
    script: path.join(options.projectRoot, 'python', 'pad_server.py'),
    client: path.join(options.projectRoot, 'resources', 'vigem', 'ViGEmClient.dll'),
  });
  for (const c of candidates) {
    if (existsSync(c.python) && existsSync(c.script) && existsSync(c.client)) return ok(c);
  }
  return err(
    'pad.helper',
    'The virtual controller helper is not installed.',
    `Looked for: ${candidates.map((c) => `${c.python} + ${c.script} + ${c.client}`).join('; ')}. In development run "npm run setup:python".`
  );
}

const MessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), version: z.string() }),
  z.object({ type: z.literal('plugged'), kind: VirtualPadKindSchema }),
  z.object({ type: z.literal('unplugged') }),
  z.object({
    type: z.literal('status'),
    plugged: z.boolean(),
    kind: VirtualPadKindSchema.optional(),
    reports: z.number().int().min(0),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
type Message = z.infer<typeof MessageSchema>;

export class SidecarVirtualPads implements VirtualPads {
  private child: ChildProcess | undefined;
  private label: string | undefined;
  private last: PadReport | undefined;
  private waiting: { want: Message['type'][]; resolve: (m: Message) => void }[] = [];
  private listeners = new Set<(status: VirtualPadStatus) => void>();
  private stderr = '';
  private unplugging = false;

  constructor(
    private readonly locate: () => Result<PadHelperLocation>,
    private readonly reader: () => string | undefined,
    private readonly log: Logger,
    private readonly answerTimeoutMs = 10_000
  ) {}

  private ask(command: object, want: Message['type'][]): Promise<Message> {
    const child = this.child;
    return new Promise((resolve) => {
      if (!child) {
        resolve({ type: 'error', code: 'pad.helper', message: 'The helper is not running.' });
        return;
      }
      const timer = setTimeout(() => {
        this.waiting = this.waiting.filter((w) => w !== entry);
        resolve({ type: 'error', code: 'pad.timeout', message: 'The helper did not answer.' });
      }, this.answerTimeoutMs);
      const entry = {
        want: [...want, 'error' as const],
        resolve: (m: Message) => {
          clearTimeout(timer);
          resolve(m);
        },
      };
      this.waiting.push(entry);
      try {
        child.stdin!.write(JSON.stringify(command) + '\n');
      } catch (e) {
        // The pipe closed under us: the helper is gone, which the 'close' handler reports.
        this.waiting = this.waiting.filter((w) => w !== entry);
        entry.resolve({
          type: 'error',
          code: 'pad.helper',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    });
  }

  private startHelper(): Promise<Result<void>> {
    if (this.child) return Promise.resolve(ok(undefined));
    const location = this.locate();
    if (!location.ok) return Promise.resolve(location);
    const { python, script, client } = location.value;
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: Result<void>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const child = spawn(python, [script, '--client', client], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
      const timer = setTimeout(() => {
        child.kill();
        settle(err('pad.timeout', 'The virtual controller helper did not start in time.'));
      }, this.answerTimeoutMs);
      this.stderr = '';
      child.stderr!.on('data', (chunk: Buffer) => {
        this.stderr = (this.stderr + chunk.toString()).slice(-2000);
      });
      child.once('error', (e) =>
        settle(err('pad.spawn', 'Could not start the virtual controller helper.', e.message))
      );
      child.once('close', (code) => {
        const wasPlugged = this.label !== undefined && !this.unplugging;
        this.child = undefined;
        for (const w of this.waiting.splice(0)) {
          w.resolve({ type: 'error', code: 'pad.exit', message: 'The helper stopped.' });
        }
        settle(
          err(
            'pad.exit',
            `The virtual controller helper stopped (exit code ${code}).`,
            this.stderr.trim() || undefined
          )
        );
        if (wasPlugged) {
          const reason = `The virtual controller helper stopped (exit code ${code}).`;
          this.log.warn(reason, this.stderr.trim());
          this.label = undefined;
          const status: VirtualPadStatus = { plugged: false, reports: 0, lost: reason };
          for (const listener of this.listeners) listener(status);
        }
      });
      readline.createInterface({ input: child.stdout!, crlfDelay: Infinity }).on('line', (line) => {
        let parsed;
        try {
          parsed = MessageSchema.safeParse(JSON.parse(line));
        } catch {
          return; // not JSON: ignored, as the input reader does
        }
        if (!parsed.success) return;
        const message = parsed.data;
        if (message.type === 'ready') {
          this.child = child;
          this.log.info(`virtual controller helper ready: ${message.version}`);
          settle(ok(undefined));
          return;
        }
        if (message.type === 'error' && this.waiting.length === 0) {
          this.log.warn(`virtual controller helper: ${message.message}`, message.code);
          return;
        }
        const index = this.waiting.findIndex((w) => w.want.includes(message.type));
        if (index >= 0) this.waiting.splice(index, 1)[0]!.resolve(message);
      });
    });
  }

  async plug(kind: VirtualPadKind, label: string): Promise<Result<void>> {
    const started = await this.startHelper();
    if (!started.ok) return started;
    const answer = await this.ask({ command: 'plug', kind }, ['plugged']);
    if (answer.type === 'error') {
      return err(answer.code, answer.message);
    }
    this.label = label;
    this.last = undefined;
    return ok(undefined);
  }

  send(report: PadReport): Result<void> {
    const child = this.child;
    if (!child || this.label === undefined) {
      return err('pad.notPlugged', 'No virtual controller is plugged in.');
    }
    try {
      child.stdin!.write(JSON.stringify({ command: 'report', ...report }) + '\n');
    } catch (e) {
      return err('pad.helper', 'The virtual controller helper is gone.', String(e));
    }
    this.last = report;
    return ok(undefined);
  }

  async unplug(): Promise<Result<void>> {
    const child = this.child;
    if (!child) {
      this.label = undefined;
      return ok(undefined);
    }
    this.unplugging = true;
    try {
      await this.ask({ command: 'unplug' }, ['unplugged']);
      // The helper is not needed without a controller: it ends, and the driver lets go.
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => {
          child.kill();
          resolve();
        }, 1500);
        child.once('close', () => {
          clearTimeout(force);
          resolve();
        });
        try {
          child.stdin!.write(JSON.stringify({ command: 'stop' }) + '\n');
        } catch {
          // The pipe is already closed: the helper is ending anyway.
          child.kill();
        }
      });
    } finally {
      this.unplugging = false;
      this.label = undefined;
    }
    return ok(undefined);
  }

  async status(): Promise<Result<VirtualPadStatus>> {
    if (!this.child) return ok({ plugged: false, reports: 0 });
    const answer = await this.ask({ command: 'status' }, ['status']);
    if (answer.type === 'error') return err(answer.code, answer.message);
    if (answer.type !== 'status') return err('pad.helper', 'Unexpected answer from the helper.');
    return ok({
      plugged: answer.plugged,
      ...(answer.kind ? { kind: answer.kind } : {}),
      ...(this.label !== undefined && answer.plugged ? { label: this.label } : {}),
      reports: answer.reports,
      ...(this.last && answer.plugged ? { last: this.last } : {}),
    });
  }

  subscribe(listener: (status: VirtualPadStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  readerProgram(): string | undefined {
    return this.reader();
  }
}
