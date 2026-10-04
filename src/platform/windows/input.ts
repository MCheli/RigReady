import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import type { Logger } from '../../core/logger';
import type { InputProvider } from '../../core/ports';
import { err, ok, type Result } from '../../core/result';
import {
  InputDeviceSchema,
  InputStateSchema,
  type InputDevice,
  type InputState,
} from '../../shared/models';
import { z } from 'zod';

/**
 * Live DirectInput state through the Python sidecar (python/input_server.py), which
 * calls DirectInput 8 itself and so lists exactly the controllers a game lists, with
 * their instance GUIDs. The sidecar speaks newline-delimited JSON on stdin/stdout.
 */

export interface SidecarLocation {
  python: string;
  script: string;
}

/**
 * Finds the bundled interpreter and script.
 * Packaged: <resources>/python/python.exe and <resources>/sidecar/input_server.py
 * (both shipped through electron-builder extraResources, outside app.asar).
 * Development: resources/python (created by `npm run setup:python`) and python/.
 */
export function locateSidecar(options: {
  resourcesPath?: string;
  projectRoot: string;
}): Result<SidecarLocation> {
  const candidates: SidecarLocation[] = [];
  if (options.resourcesPath) {
    candidates.push({
      python: path.join(options.resourcesPath, 'python', 'python.exe'),
      script: path.join(options.resourcesPath, 'sidecar', 'input_server.py'),
    });
  }
  candidates.push({
    python: path.join(options.projectRoot, 'resources', 'python', 'python.exe'),
    script: path.join(options.projectRoot, 'python', 'input_server.py'),
  });
  for (const candidate of candidates) {
    if (existsSync(candidate.python) && existsSync(candidate.script)) return ok(candidate);
  }
  return err(
    'input.sidecar',
    'The input reader is not installed.',
    `Looked for: ${candidates.map((c) => `${c.python} + ${c.script}`).join('; ')}. In development run "npm run setup:python".`
  );
}

const MessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), version: z.string(), devices: z.array(InputDeviceSchema) }),
  z.object({ type: z.literal('devices'), devices: z.array(InputDeviceSchema) }),
  z.object({ type: z.literal('devicesChanged'), devices: z.array(InputDeviceSchema) }),
  z.object({ type: z.literal('inputStates'), states: z.array(InputStateSchema) }),
  z.object({ type: z.literal('pong') }),
  z.object({ type: z.literal('shutdown') }),
]);

export class SidecarInputProvider implements InputProvider {
  private child: ChildProcess | undefined;
  private current: InputDevice[] = [];
  private listeners = new Set<(states: InputState[]) => void>();
  /** Last known state per device index, so a new subscriber starts with the full picture. */
  private latest = new Map<number, InputState>();
  private starting: Promise<Result<InputDevice[]>> | undefined;

  constructor(
    private readonly locate: () => Result<SidecarLocation>,
    private readonly log: Logger,
    private readonly readyTimeoutMs = 15_000
  ) {}

  /**
   * Idempotent (see InputProvider): answers at once while the sidecar runs, shares one
   * start between concurrent callers, and starts again after a failure or a stop.
   */
  start(): Promise<Result<InputDevice[]>> {
    if (this.child) return Promise.resolve(ok(this.current));
    this.starting ??= this.spawnSidecar().finally(() => (this.starting = undefined));
    return this.starting;
  }

  private spawnSidecar(): Promise<Result<InputDevice[]>> {
    const location = this.locate();
    if (!location.ok) return Promise.resolve(location);
    const { python, script } = location.value;

    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: Result<InputDevice[]>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const child = spawn(python, [script], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      });
      const timer = setTimeout(() => {
        child.kill();
        settle(err('input.timeout', 'The input reader did not start in time.'));
      }, this.readyTimeoutMs);

      let stderr = '';
      child.stderr!.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      child.once('error', (e) =>
        settle(err('input.spawn', 'Could not start the input reader.', e.message))
      );
      child.once('exit', (code) => {
        this.child = undefined;
        this.current = [];
        this.latest.clear();
        if (!settled) {
          settle(
            err(
              'input.exit',
              `The input reader stopped (exit code ${code}).`,
              stderr.trim() || undefined
            )
          );
        } else if (code !== 0 && code !== null) {
          this.log.warn(`input sidecar exited with code ${code}`, stderr.trim());
        }
      });

      readline.createInterface({ input: child.stdout!, crlfDelay: Infinity }).on('line', (line) => {
        let parsed;
        try {
          parsed = MessageSchema.safeParse(JSON.parse(line));
        } catch {
          return; // ignore anything that is not JSON
        }
        if (!parsed.success) return;
        const message = parsed.data;
        switch (message.type) {
          case 'ready':
            this.child = child;
            this.current = message.devices;
            this.log.info(
              `input sidecar ready: ${message.version}, ${message.devices.length} devices`
            );
            settle(ok(message.devices));
            break;
          case 'devices':
          case 'devicesChanged':
            this.current = message.devices;
            this.latest.clear();
            break;
          case 'inputStates':
            for (const state of message.states) this.latest.set(state.index, state);
            for (const listener of this.listeners) listener(message.states);
            break;
          default:
            break;
        }
      });
    });
  }

  async stop(): Promise<void> {
    // A reader that is still starting is stopped too, once it is up: nothing is left behind.
    if (this.starting) await this.starting;
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => child.kill(), 1500);
      child.once('exit', () => {
        clearTimeout(force);
        resolve();
      });
      try {
        child.stdin!.write(JSON.stringify({ command: 'stop' }) + '\n');
      } catch {
        child.kill();
      }
    });
  }

  devices(): InputDevice[] {
    return this.current;
  }

  subscribe(listener: (states: InputState[]) => void): () => void {
    this.listeners.add(listener);
    if (this.latest.size > 0) listener([...this.latest.values()]);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
