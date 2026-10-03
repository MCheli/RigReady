import path from 'node:path';
import { promises as fs } from 'node:fs';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { BackupFileStore } from '../../core/files/fileStore';
import type {
  AudioProvider,
  Clock,
  DeviceProvider,
  DisplayApplyOutcome,
  DisplayProvider,
  InputProvider,
  KnownFolders,
  Ports,
  ProcessProvider,
  Shell,
  ShellResult,
} from '../../core/ports';
import { err, ok, type Result } from '../../core/result';
import type {
  AudioState,
  DeviceInfo,
  DisplayInfo,
  DisplayLayout,
  DisplayTarget,
  InputDevice,
  InputState,
  LaunchTarget,
  ProcessInfo,
} from '../../shared/models';
import { NodeRawFs, systemClock } from '../node';
import {
  RigFixtureSchema,
  ScenarioSchema,
  applyMutations,
  type Mutation,
  type RigState,
  type Scenario,
} from './scenario';

/**
 * Fixture-backed providers. They are stateful the way the machine is: starting a
 * process makes it show up in the list, applying a layout changes what read() returns.
 */

export class FakeDeviceProvider implements DeviceProvider {
  constructor(private readonly state: RigState) {}
  async list(): Promise<Result<DeviceInfo[]>> {
    return ok(structuredClone(this.state.devices));
  }
}

export class FakeProcessProvider implements ProcessProvider {
  /** Every start() call, for assertions. */
  readonly started: LaunchTarget[] = [];
  constructor(private readonly state: RigState) {}

  async list(): Promise<Result<ProcessInfo[]>> {
    return ok(structuredClone(this.state.processes));
  }

  async start(target: LaunchTarget): Promise<Result<{ pid: number | undefined }>> {
    if (!path.win32.isAbsolute(target.exe)) {
      return err(
        'shell.launch',
        `Could not start ${target.exe}.`,
        'The program path must be absolute.'
      );
    }
    this.started.push(target);
    const pid = Math.max(1000, ...this.state.processes.map((p) => p.pid)) + 4;
    this.state.processes.push({ pid, name: path.win32.basename(target.exe), path: target.exe });
    return ok({ pid });
  }

  async stop(pid: number): Promise<Result<void>> {
    const index = this.state.processes.findIndex((p) => p.pid === pid);
    if (index < 0) return err('process.stop', `Could not open process ${pid} to stop it.`);
    this.state.processes.splice(index, 1);
    return ok(undefined);
  }
}

export class FakeDisplayProvider implements DisplayProvider {
  private undo: DisplayInfo[][] = [];
  constructor(private readonly state: RigState) {}

  async read(): Promise<Result<DisplayLayout>> {
    return ok({ displays: structuredClone(this.state.displays) });
  }

  async apply(targets: DisplayTarget[]): Promise<Result<DisplayApplyOutcome>> {
    const previous = structuredClone(this.state.displays);
    const next = structuredClone(this.state.displays);
    for (const target of targets) {
      const display = next.find((d) => d.id === target.id.toLowerCase());
      if (!display)
        return err('display.missing', `Monitor is not connected: ${target.name || target.id}`);
      if (!target.enabled) {
        Object.assign(display, {
          enabled: false,
          primary: false,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          rotation: 0,
        });
        continue;
      }
      // Native (unrotated) size comes from the current mode, or from the target when enabling.
      const sideways = display.rotation === 90 || display.rotation === 270;
      let nativeW = sideways ? display.height : display.width;
      let nativeH = sideways ? display.width : display.height;
      const targetSideways = target.rotation === 90 || target.rotation === 270;
      if (target.width !== undefined && target.height !== undefined) {
        nativeW = targetSideways ? target.height : target.width;
        nativeH = targetSideways ? target.width : target.height;
      }
      if (nativeW === 0 || nativeH === 0) {
        return err(
          'display.apply',
          'Could not apply the monitor layout.',
          `No known mode for ${display.name}`
        );
      }
      Object.assign(display, {
        enabled: true,
        x: target.x,
        y: target.y,
        rotation: target.rotation,
        width: targetSideways ? nativeH : nativeW,
        height: targetSideways ? nativeW : nativeH,
        primary: target.primary,
      });
    }
    const enabled = next.filter((d) => d.enabled);
    if (enabled.length === 0)
      return err('display.none', 'The layout would turn every monitor off.');
    // As on Windows: exactly one primary, and it sits at (0,0).
    const primary =
      enabled.find(
        (d) => d.primary && targets.some((t) => t.id.toLowerCase() === d.id && t.primary)
      ) ??
      enabled.find((d) => d.x === 0 && d.y === 0) ??
      enabled[0]!;
    const dx = primary.x;
    const dy = primary.y;
    for (const d of enabled) {
      d.primary = d === primary;
      d.x -= dx;
      d.y -= dy;
    }
    this.undo.push(previous);
    this.state.displays = next;
    return ok({ previous: { displays: previous }, current: { displays: structuredClone(next) } });
  }

  canRevert(): boolean {
    return this.undo.length > 0;
  }

  async revert(): Promise<Result<DisplayLayout>> {
    const previous = this.undo.pop();
    if (!previous)
      return err('display.norevert', 'There is no earlier monitor layout to go back to.');
    this.state.displays = previous;
    return this.read();
  }
}

export class FakeAudioProvider implements AudioProvider {
  constructor(private readonly state: RigState) {}
  async read(): Promise<Result<AudioState>> {
    return ok(structuredClone(this.state.audio));
  }
}

export class FakeInputProvider implements InputProvider {
  private listeners = new Set<(states: InputState[]) => void>();
  constructor(private readonly state: RigState) {}
  async start(): Promise<Result<InputDevice[]>> {
    return ok(this.devices());
  }
  async stop(): Promise<void> {}
  devices(): InputDevice[] {
    return structuredClone(this.state.input);
  }
  subscribe(listener: (states: InputState[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** Test hook: deliver input as if the user pressed something. */
  emit(states: InputState[]): void {
    for (const listener of this.listeners) listener(states);
  }
}

/** Every folder lives under one root, so a scenario run cannot touch the real profile. */
export class FakeKnownFolders implements KnownFolders {
  constructor(
    private readonly root: string,
    private readonly data: string,
    private readonly steam: string[] = []
  ) {}
  home(): string {
    return this.root;
  }
  documents(): string {
    return path.join(this.root, 'Documents');
  }
  savedGames(): string {
    return path.join(this.root, 'Saved Games');
  }
  appData(): string {
    return path.join(this.root, 'AppData', 'Roaming');
  }
  localAppData(): string {
    return path.join(this.root, 'AppData', 'Local');
  }
  dataRoot(): string {
    return this.data;
  }
  async steamLibraries(): Promise<Result<string[]>> {
    return ok(this.steam);
  }
}

/** Records what would have been run; nothing is executed. */
export class FakeShell implements Shell {
  readonly calls: { exe: string; args: string[] }[] = [];
  constructor(private readonly processes: FakeProcessProvider) {}
  async run(exe: string, args: string[]): Promise<Result<ShellResult>> {
    this.calls.push({ exe, args });
    return ok({ code: 0, stdout: '', stderr: '' });
  }
  launch(
    exe: string,
    args: string[],
    options: { cwd?: string } = {}
  ): Promise<Result<{ pid: number | undefined }>> {
    this.calls.push({ exe, args });
    return this.processes.start(options.cwd ? { exe, args, cwd: options.cwd } : { exe, args });
  }
}

export interface FakePorts extends Ports {
  devices: FakeDeviceProvider;
  processes: FakeProcessProvider;
  displays: FakeDisplayProvider;
  input: FakeInputProvider;
  shell: FakeShell;
  /** The mutable machine state behind the providers. */
  state: RigState;
}

export interface FakePlatformOptions {
  state: RigState;
  /** Stand-in for the user profile folder. */
  homeDir: string;
  /** RigReady data root. Defaults to <homeDir>/.rigready. */
  dataRoot?: string;
  clock?: Clock;
}

export function createFakePorts(options: FakePlatformOptions): FakePorts {
  const state = structuredClone(options.state);
  const dataRoot = options.dataRoot ?? path.join(options.homeDir, '.rigready');
  const clock = options.clock ?? systemClock;
  const processes = new FakeProcessProvider(state);
  return {
    state,
    devices: new FakeDeviceProvider(state),
    input: new FakeInputProvider(state),
    displays: new FakeDisplayProvider(state),
    processes,
    audio: new FakeAudioProvider(state),
    files: new BackupFileStore(new NodeRawFs(), dataRoot, clock),
    folders: new FakeKnownFolders(options.homeDir, dataRoot),
    shell: new FakeShell(processes),
    clock,
  };
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/** Loads fixtures/rigs/<name>/ (devices.json, displays.json, processes.json, audio.json, input.json). */
export async function loadRig(rigDir: string): Promise<RigState> {
  const optional = async (name: string): Promise<unknown> => {
    try {
      return await readJson(path.join(rigDir, name));
    } catch {
      return undefined;
    }
  };
  const parsed = RigFixtureSchema.parse({
    devices: await readJson(path.join(rigDir, 'devices.json')),
    displays: await readJson(path.join(rigDir, 'displays.json')),
    processes: await readJson(path.join(rigDir, 'processes.json')),
    audio: await readJson(path.join(rigDir, 'audio.json')),
    input: await optional('input.json'),
  });
  return {
    devices: parsed.devices,
    displays: parsed.displays.displays,
    processes: parsed.processes,
    audio: parsed.audio,
    input: parsed.input,
  };
}

export interface LoadedScenario {
  scenario: Scenario;
  state: RigState;
  /** Absolute paths of the profile files to seed. */
  profileFiles: string[];
}

/** Reads a scenario file, follows `extends`, loads its rig and applies the mutations. */
export async function loadScenario(
  scenarioFile: string,
  fixturesDir: string
): Promise<LoadedScenario> {
  const file = path.resolve(scenarioFile);
  const chain: { scenario: Scenario; file: string }[] = [];
  let current: string | undefined = file;
  while (current) {
    if (chain.some((c) => c.file === current))
      throw new Error(`Scenario extends itself: ${current}`);
    const raw = yaml.load(await fs.readFile(current, 'utf8'));
    const parsed = ScenarioSchema.safeParse(raw);
    if (!parsed.success)
      throw new Error(`Invalid scenario ${current}:\n${z.prettifyError(parsed.error)}`);
    chain.unshift({ scenario: parsed.data, file: current });
    current = parsed.data.extends
      ? path.resolve(path.dirname(current), parsed.data.extends)
      : undefined;
  }
  const leaf = chain[chain.length - 1]!;
  const mutations: Mutation[] = chain.flatMap((c) => c.scenario.mutations);
  const profileFiles = chain.flatMap((c) =>
    c.scenario.profiles.map((p) => path.resolve(path.dirname(c.file), p))
  );
  const rig = await loadRig(path.join(fixturesDir, 'rigs', leaf.scenario.rig));
  return { scenario: leaf.scenario, state: applyMutations(rig, mutations), profileFiles };
}
