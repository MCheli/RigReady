import path from 'node:path';
import { promises as fs } from 'node:fs';
import * as yaml from 'js-yaml';
import { z } from 'zod';
import { BackupFileStore } from '../../core/files/fileStore';
import { createMatcher } from '../../core/files/glob';
import type {
  AppWindow,
  AudioProvider,
  Clock,
  CloseOptions,
  DeviceProvider,
  Dialogs,
  DisplayApplyOutcome,
  DisplayProvider,
  Http,
  HttpRequest,
  HttpResponse,
  InputProvider,
  KnownFolders,
  LoginItem,
  Notifications,
  OpenDialogOptions,
  Overlays,
  Ports,
  ProcessProvider,
  Registry,
  Render,
  SaveDialogOptions,
  ScreenArea,
  ScreenLabel,
  Secrets,
  ServiceProvider,
  Shell,
  ShellOptions,
  ShellResult,
} from '../../core/ports';
import { err, ok, type Result } from '../../core/result';
import { findSteamLibraries } from '../../core/steam';
import type {
  AudioRole,
  AudioState,
  DeviceInfo,
  DisplayInfo,
  DisplayLayout,
  DisplayTarget,
  InputDevice,
  InputState,
  LaunchTarget,
  ProcessInfo,
  RegistryHive,
  RegistryValue,
  ServiceInfo,
} from '../../shared/models';
import { NodeRawFs, systemClock } from '../node';
import { solidPng } from './png';
import {
  DialogScriptSchema,
  RigFixtureSchema,
  ScenarioSchema,
  applyMutations,
  findRegistryKey,
  isFileMutation,
  isHung,
  mutateState,
  never,
  registryKeyPath,
  type DialogScript,
  type FileMutation,
  type HttpScript,
  type Mutation,
  type RigState,
  type Scenario,
  type ShellScript,
} from './scenario';

/**
 * Fixture-backed providers. They are stateful the way the machine is: starting a
 * process makes it show up in the list, applying a layout changes what read() returns.
 */

const REHOME =
  /C:(\\\\|\\|\/)(?:Users\1User(?![\w.-])|(Program Files \(x86\)|Program Files|ProgramData)(?![\w]))/gi;

/**
 * Points recorded paths at the fake user folder: C:\Users\User becomes the folder
 * itself, and C:\Program Files, C:\Program Files (x86) and C:\ProgramData become
 * folders inside it. Handles `\`, `\\` (JSON, Lua, VDF) and `/` separators.
 */
export function rehomePaths(text: string, home: string): string {
  return text.replace(REHOME, (_all, separator: string, folder: string | undefined) => {
    const base = home.replace(/[\\/]+$/, '').replace(/[\\/]/g, () => separator);
    return folder ? `${base}${separator}${folder}` : base;
  });
}

function rehomeDeep<T>(value: T, home: string): T {
  if (typeof value === 'string') return rehomePaths(value, home) as T;
  if (Array.isArray(value)) return value.map((v) => rehomeDeep(v, home)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rehomeDeep(v, home)])) as T;
  }
  return value;
}

export class FakeDeviceProvider implements DeviceProvider {
  private listeners = new Set<() => void>();
  constructor(private readonly state: RigState) {}
  async list(): Promise<Result<DeviceInfo[]>> {
    if (isHung(this.state, 'devices')) return never();
    return ok(structuredClone(this.state.devices));
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** Test hook: tell subscribers a device was plugged in or removed. */
  emitChanged(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export class FakeProcessProvider implements ProcessProvider {
  /** Every start() call, for assertions. */
  readonly started: LaunchTarget[] = [];
  /** Every close() call, for assertions. */
  readonly closed: { pid: number; name: string; options: CloseOptions }[] = [];
  /** Lower-case process names that ignore a polite close (they only go away when forced). */
  readonly stubborn = new Set<string>();
  constructor(private readonly state: RigState) {}

  async list(): Promise<Result<ProcessInfo[]>> {
    if (isHung(this.state, 'processes')) return never();
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
    const fault = this.state.faults?.startFails[path.win32.basename(target.exe).toLowerCase()];
    if (fault === 'error') {
      return err('shell.launch', `Could not start ${target.exe}.`, 'Access is denied.');
    }
    this.started.push(target);
    // Accepted by Windows, but the program exits at once and never shows up.
    if (fault === 'neverRuns') return ok({ pid: undefined });
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

  async close(
    pid: number,
    options: CloseOptions = {}
  ): Promise<Result<{ outcome: 'closed' | 'terminated' }>> {
    const index = this.state.processes.findIndex((p) => p.pid === pid);
    if (index < 0) return err('process.stop', `Could not open process ${pid} to close it.`);
    const name = this.state.processes[index]!.name;
    this.closed.push({ pid, name, options });
    if (this.stubborn.has(name.toLowerCase())) {
      if (!options.force) {
        return err(
          'process.stillRunning',
          `Process ${pid} did not close within ${Math.round((options.waitMs ?? 10_000) / 1000)} s.`
        );
      }
      this.state.processes.splice(index, 1);
      return ok({ outcome: 'terminated' });
    }
    this.state.processes.splice(index, 1);
    return ok({ outcome: 'closed' });
  }
}

export class FakeServiceProvider implements ServiceProvider {
  constructor(private readonly state: RigState) {}
  async list(): Promise<Result<ServiceInfo[]>> {
    if (isHung(this.state, 'services')) return never();
    return ok(structuredClone(this.state.services));
  }
  async get(name: string): Promise<Result<ServiceInfo | undefined>> {
    if (isHung(this.state, 'services')) return never();
    const found = this.state.services.find((s) => s.name.toLowerCase() === name.toLowerCase());
    return ok(found ? structuredClone(found) : undefined);
  }
}

export class FakeDisplayProvider implements DisplayProvider {
  private undo: DisplayInfo[][] = [];
  constructor(private readonly state: RigState) {}

  async read(): Promise<Result<DisplayLayout>> {
    if (isHung(this.state, 'displays')) return never();
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
      // As Windows: a mode the monitor does not list is refused, and nothing changes.
      const refreshHz = target.refreshHz ?? display.refreshHz;
      const modeChanges =
        (display.enabled &&
          (nativeW !== (sideways ? display.height : display.width) ||
            nativeH !== (sideways ? display.width : display.height))) ||
        (target.refreshHz !== undefined &&
          Math.abs((display.refreshHz ?? 0) - target.refreshHz) >= 0.5);
      if (
        modeChanges &&
        display.modes &&
        display.modes.length > 0 &&
        !display.modes.some(
          (m) =>
            m.width === nativeW &&
            m.height === nativeH &&
            (target.refreshHz === undefined || Math.abs(m.refreshHz - target.refreshHz) < 0.5)
        )
      ) {
        return err(
          'display.mode',
          'Could not apply the monitor layout.',
          `${display.name} does not offer ${nativeW}x${nativeH}${target.refreshHz !== undefined ? ` at ${target.refreshHz} Hz` : ''}`
        );
      }
      if (refreshHz !== undefined) display.refreshHz = refreshHz;
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
  /** Every setDefault() call, for assertions. */
  readonly calls: { id: string; roles: AudioRole[] }[] = [];
  constructor(private readonly state: RigState) {}
  async read(): Promise<Result<AudioState>> {
    if (isHung(this.state, 'audio')) return never();
    return ok(structuredClone(this.state.audio));
  }
  async setDefault(id: string, options: { roles?: AudioRole[] } = {}): Promise<Result<AudioState>> {
    const roles = options.roles ?? (['console', 'multimedia', 'communications'] as AudioRole[]);
    const device = this.state.audio.devices.find((d) => d.id === id);
    if (!device) {
      return err('audio.missing', 'That audio device is not connected or is disabled.', id);
    }
    this.calls.push({ id, roles });
    const playback = device.flow === 'playback';
    if (roles.includes('console') || roles.includes('multimedia')) {
      this.state.audio[playback ? 'defaultPlayback' : 'defaultRecording'] = { ...device };
    }
    if (roles.includes('communications')) {
      this.state.audio[playback ? 'defaultCommsPlayback' : 'defaultCommsRecording'] = {
        ...device,
      };
    }
    return this.read();
  }
}

export class FakeInputProvider implements InputProvider {
  private listeners = new Set<(states: InputState[]) => void>();
  private latest = new Map<number, InputState>();
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
    if (this.latest.size > 0) listener([...this.latest.values()]);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** Test hook: deliver input as if the user pressed something. */
  emit(states: InputState[]): void {
    for (const state of states) this.latest.set(state.index, state);
    for (const listener of this.listeners) listener(states);
  }
}

/** The recorded registry keys. Lookups ignore case, as Windows does. */
export class FakeRegistry implements Registry {
  constructor(private readonly state: RigState) {}

  async getValue(
    hive: RegistryHive,
    key: string,
    name: string
  ): Promise<Result<RegistryValue | undefined>> {
    const values = await this.listValues(hive, key);
    if (!values.ok) return values;
    const found = Object.keys(values.value).find((n) => n.toLowerCase() === name.toLowerCase());
    return ok(found === undefined ? undefined : values.value[found]);
  }

  async listKeys(hive: RegistryHive, key: string): Promise<Result<string[]>> {
    const prefix = `${registryKeyPath(hive, key).toLowerCase()}\\`;
    const children = new Map<string, string>();
    for (const full of Object.keys(this.state.registry)) {
      if (!full.toLowerCase().startsWith(prefix)) continue;
      const child = full.slice(prefix.length).split('\\')[0]!;
      if (!children.has(child.toLowerCase())) children.set(child.toLowerCase(), child);
    }
    return ok([...children.values()]);
  }

  async listValues(
    hive: RegistryHive,
    key: string
  ): Promise<Result<Record<string, RegistryValue>>> {
    const found = findRegistryKey(this.state.registry, registryKeyPath(hive, key));
    return ok(found ? structuredClone(this.state.registry[found]!) : {});
  }
}

/**
 * Every folder lives under one root, so a scenario run cannot touch the real profile.
 * Program Files, Program Files (x86) and ProgramData are folders inside it too, which
 * is where the rig's recorded install files (the Steam library, DCS) are placed.
 */
export class FakeKnownFolders implements KnownFolders {
  constructor(
    private readonly root: string,
    private readonly data: string,
    private readonly registry: Registry
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
  programFiles(): string {
    return path.join(this.root, 'Program Files');
  }
  programFilesX86(): string {
    return path.join(this.root, 'Program Files (x86)');
  }
  programData(): string {
    return path.join(this.root, 'ProgramData');
  }
  dataRoot(): string {
    return this.data;
  }
  steamLibraries(): Promise<Result<string[]>> {
    return findSteamLibraries(this.registry, (file) => fs.readFile(file, 'utf8'));
  }
}

const quoted = (flag: string, values: string[]): string[] => values.map((v) => `${flag} "${v}"`);

/**
 * Records what would have been run; nothing is executed. Answers come from the
 * scenario's `shell` script, and HidHideCLI.exe is emulated from the rig's HidHide state.
 */
export class FakeShell implements Shell {
  readonly calls: { exe: string; args: string[]; options?: ShellOptions }[] = [];
  /** Scripted answers, first match wins. Tests may push more. */
  readonly scripts: ShellScript[] = [];
  constructor(
    private readonly processes: FakeProcessProvider,
    private readonly state: RigState
  ) {}

  async run(exe: string, args: string[], options?: ShellOptions): Promise<Result<ShellResult>> {
    this.calls.push({ exe, args, ...(options ? { options } : {}) });
    const script = this.scripts.find(
      (s) =>
        exe.toLowerCase().includes(s.match.exe.toLowerCase()) &&
        s.match.args.every((a) => args.includes(a))
    );
    if (script) return ok({ ...script.result });
    if (path.win32.basename(exe).toLowerCase() === 'hidhidecli.exe') return this.hidHide(exe, args);
    return ok({ code: 0, stdout: '', stderr: '' });
  }

  private hidHide(exe: string, args: string[]): Result<ShellResult> {
    const hidHide = this.state.hidHide;
    if (!hidHide.installed) return err('shell.spawn', `Could not start ${exe}.`, 'spawn ENOENT');
    const lines: string[] = [];
    // The real CLI saves changes on exit unless --cancel is the last argument.
    const save = args[args.length - 1] !== '--cancel';
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === '--cloak-state') lines.push(hidHide.cloak ? '--cloak-on' : '--cloak-off');
      else if (arg === '--inv-state') lines.push(hidHide.inverse ? '--inv-on' : '--inv-off');
      else if (arg === '--dev-list') lines.push(...quoted('--dev-hide', hidHide.hidden));
      else if (arg === '--app-list') lines.push(...quoted('--app-reg', hidHide.apps));
      else if (arg === '--dev-gaming') {
        const present = new Set(this.state.devices.map((d) => d.instanceId.toUpperCase()));
        const gaming = hidHide.gaming
          .map((g) => ({
            ...g,
            devices: g.devices.filter((d) =>
              present.has(d.baseContainerDeviceInstancePath.toUpperCase())
            ),
          }))
          .filter((g) => g.devices.length > 0);
        lines.push(JSON.stringify(gaming, null, 1));
      } else if (save && (arg === '--cloak-on' || arg === '--cloak-off')) {
        hidHide.cloak = arg === '--cloak-on';
      } else if (save && arg === '--dev-unhide' && args[i + 1] !== undefined) {
        const target = args[++i]!.toLowerCase();
        hidHide.hidden = hidHide.hidden.filter((h) => h.toLowerCase() !== target);
      } else if (save && arg === '--dev-hide' && args[i + 1] !== undefined) {
        const target = args[++i]!;
        if (!hidHide.hidden.includes(target)) hidHide.hidden.push(target);
      } else if (save && arg === '--app-reg' && args[i + 1] !== undefined) {
        const target = args[++i]!;
        if (!hidHide.apps.includes(target)) hidHide.apps.push(target);
      }
    }
    return ok({ code: 0, stdout: lines.join('\r\n') + (lines.length ? '\r\n' : ''), stderr: '' });
  }

  launch(
    exe: string,
    args: string[],
    options: ShellOptions = {}
  ): Promise<Result<{ pid: number | undefined }>> {
    this.calls.push({ exe, args, ...(Object.keys(options).length > 0 ? { options } : {}) });
    return this.processes.start(options.cwd ? { exe, args, cwd: options.cwd } : { exe, args });
  }
}

/** Secrets kept in memory only. */
export class FakeSecrets implements Secrets {
  readonly values = new Map<string, string>();
  async get(name: string): Promise<Result<string | undefined>> {
    return ok(this.values.get(name));
  }
  async set(name: string, value: string): Promise<Result<void>> {
    this.values.set(name, value);
    return ok(undefined);
  }
  async remove(name: string): Promise<Result<void>> {
    this.values.delete(name);
    return ok(undefined);
  }
}

/** Answers requests from a script and never touches the network. An unscripted request is an error. */
export class FakeHttp implements Http {
  /** Every request made, for assertions. */
  readonly calls: HttpRequest[] = [];
  /** Scripted answers, first match wins. Tests may push more. */
  readonly scripts: (HttpScript & { used?: number })[] = [];

  /** Shorthand for tests: answer requests whose URL contains `url`. */
  respond(url: string, response: { status?: number; body?: string; json?: unknown }): void {
    this.scripts.push({
      match: { url },
      response: { status: response.status ?? 200, headers: {}, ...response },
    });
  }

  async request(request: HttpRequest): Promise<Result<HttpResponse>> {
    this.calls.push(structuredClone(request));
    const method = (request.method ?? 'GET').toUpperCase();
    const script = this.scripts.find(
      (s) =>
        (s.times === undefined || (s.used ?? 0) < s.times) &&
        (s.match.url === undefined || request.url.includes(s.match.url)) &&
        (s.match.method === undefined || s.match.method.toUpperCase() === method) &&
        (s.match.body === undefined || (request.body ?? '').includes(s.match.body))
    );
    if (!script) {
      return err(
        'http.unscripted',
        `No scripted response for ${method} ${request.url}.`,
        'Add one to the scenario file under "http", or call ports.http.respond(...) in the test.'
      );
    }
    script.used = (script.used ?? 0) + 1;
    if (script.error !== undefined || !script.response) {
      return err('http.network', 'Could not reach the server.', script.error ?? 'scripted failure');
    }
    const { status, headers, body, json } = script.response;
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    if (json !== undefined) {
      return ok({
        status,
        headers: { 'content-type': 'application/json', ...lower },
        body: JSON.stringify(json),
      });
    }
    return ok({ status, headers: lower, body: body ?? '' });
  }
}

/** File pickers that return scripted paths, one entry per call; "cancelled" once used up. */
export class FakeDialogs implements Dialogs {
  /** Every call, for assertions. */
  readonly calls: { kind: 'open' | 'save'; options: OpenDialogOptions | SaveDialogOptions }[] = [];
  /** Remaining answers. Tests may push more (relative paths resolve against the fake user folder). */
  readonly script: DialogScript = { open: [], save: [] };
  constructor(private readonly home: string) {}

  private resolve(p: string): string {
    return path.isAbsolute(p) ? p : path.join(this.home, p);
  }
  async open(options: OpenDialogOptions = {}): Promise<Result<string[]>> {
    this.calls.push({ kind: 'open', options });
    return ok((this.script.open.shift() ?? []).map((p) => this.resolve(p)));
  }
  async save(options: SaveDialogOptions = {}): Promise<Result<string | null>> {
    this.calls.push({ kind: 'save', options });
    const next = this.script.save.shift();
    return ok(next === undefined || next === null ? null : this.resolve(next));
  }
}

/** Returns a real PNG of the requested size (one colour) and a stub PDF; records the HTML. */
export class FakeRender implements Render {
  readonly calls: { kind: 'png' | 'pdf'; html: string; width?: number; height?: number }[] = [];
  async png(html: string, size: { width: number; height: number }): Promise<Result<Uint8Array>> {
    if (size.width < 1 || size.height < 1 || size.width > 8192 || size.height > 8192) {
      return err('render.size', 'The image size must be between 1 and 8192 pixels.');
    }
    this.calls.push({ kind: 'png', html, ...size });
    return ok(solidPng(size.width, size.height));
  }
  async pdf(html: string): Promise<Result<Uint8Array>> {
    this.calls.push({ kind: 'pdf', html });
    return ok(new TextEncoder().encode('%PDF-1.4\n% RigReady fake render\n%%EOF\n'));
  }
}

export class FakeNotifications implements Notifications {
  readonly sent: { title: string; body: string }[] = [];
  async notify(message: { title: string; body: string }): Promise<Result<void>> {
    this.sent.push({ ...message });
    return ok(undefined);
  }
}

export class FakeLoginItem implements LoginItem {
  enabled = false;
  async isEnabled(): Promise<Result<boolean>> {
    return ok(this.enabled);
  }
  async setEnabled(enabled: boolean): Promise<Result<void>> {
    this.enabled = enabled;
    return ok(undefined);
  }
}

export class FakeOverlays implements Overlays {
  /** Every showLabels() call, for assertions. */
  readonly shown: { labels: ScreenLabel[]; durationMs: number }[] = [];
  async showLabels(labels: ScreenLabel[], durationMs: number): Promise<Result<void>> {
    this.shown.push({ labels: structuredClone(labels), durationMs });
    return ok(undefined);
  }
}

export class FakeAppWindow implements AppWindow {
  /** Every showOn() call, for assertions. */
  readonly shown: ScreenArea[][] = [];
  async showOn(areas: ScreenArea[]): Promise<Result<{ moved: boolean }>> {
    this.shown.push(structuredClone(areas));
    return ok({ moved: false });
  }
}

export interface FakePorts extends Ports {
  devices: FakeDeviceProvider;
  processes: FakeProcessProvider;
  services: FakeServiceProvider;
  displays: FakeDisplayProvider;
  audio: FakeAudioProvider;
  input: FakeInputProvider;
  registry: FakeRegistry;
  shell: FakeShell;
  http: FakeHttp;
  dialogs: FakeDialogs;
  notifications: FakeNotifications;
  loginItem: FakeLoginItem;
  overlays: FakeOverlays;
  window: FakeAppWindow;
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
  /** Scripted answers from the scenario file. */
  scenario?: Pick<Scenario, 'http' | 'shell' | 'dialogs'>;
}

export function createFakePorts(options: FakePlatformOptions): FakePorts {
  const state = structuredClone(options.state);
  // Recorded paths (install locations in the registry, program paths) point into the fake home.
  state.registry = rehomeDeep(state.registry, options.homeDir);
  state.hidHide = rehomeDeep(state.hidHide, options.homeDir);
  const dataRoot = options.dataRoot ?? path.join(options.homeDir, '.rigready');
  const clock = options.clock ?? systemClock;
  const processes = new FakeProcessProvider(state);
  const registry = new FakeRegistry(state);
  const shell = new FakeShell(processes, state);
  const http = new FakeHttp();
  const dialogs = new FakeDialogs(options.homeDir);
  if (options.scenario) {
    shell.scripts.push(...structuredClone(options.scenario.shell));
    http.scripts.push(...structuredClone(options.scenario.http));
    dialogs.script.open.push(...structuredClone(options.scenario.dialogs.open));
    dialogs.script.save.push(...options.scenario.dialogs.save);
  }
  return {
    state,
    devices: new FakeDeviceProvider(state),
    input: new FakeInputProvider(state),
    displays: new FakeDisplayProvider(state),
    processes,
    services: new FakeServiceProvider(state),
    audio: new FakeAudioProvider(state),
    registry,
    files: new BackupFileStore(new NodeRawFs(), dataRoot, clock),
    folders: new FakeKnownFolders(options.homeDir, dataRoot, registry),
    shell,
    clock,
    secrets: new FakeSecrets(),
    http,
    dialogs,
    render: new FakeRender(),
    notifications: new FakeNotifications(),
    loginItem: new FakeLoginItem(),
    overlays: new FakeOverlays(),
    window: new FakeAppWindow(),
  };
}

/** Adds file-picker answers given as JSON in RIGREADY_DIALOG_OPEN / RIGREADY_DIALOG_SAVE (used by e2e tests). */
export function dialogScriptFromEnv(env: NodeJS.ProcessEnv): DialogScript {
  const parse = (name: string): unknown => {
    const raw = env[name];
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`${name} must be JSON`);
    }
  };
  return DialogScriptSchema.parse({
    open: parse('RIGREADY_DIALOG_OPEN') ?? [],
    save: parse('RIGREADY_DIALOG_SAVE') ?? [],
  });
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/**
 * Loads fixtures/rigs/<name>/: devices.json, displays.json, processes.json, audio.json,
 * and when present input.json, services.json, registry.json and hidhide.json.
 */
export async function loadRig(rigDir: string): Promise<RigState> {
  const optional = async (name: string): Promise<unknown> => {
    try {
      return await readJson(path.join(rigDir, name));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  };
  const parsed = RigFixtureSchema.parse({
    devices: await readJson(path.join(rigDir, 'devices.json')),
    displays: await readJson(path.join(rigDir, 'displays.json')),
    processes: await readJson(path.join(rigDir, 'processes.json')),
    audio: await readJson(path.join(rigDir, 'audio.json')),
    input: await optional('input.json'),
    services: await optional('services.json'),
    registry: await optional('registry.json'),
    hidHide: await optional('hidhide.json'),
  });
  return {
    devices: parsed.devices,
    displays: parsed.displays.displays,
    processes: parsed.processes,
    audio: parsed.audio,
    input: parsed.input,
    services: parsed.services,
    registry: parsed.registry,
    hidHide: parsed.hidHide,
  };
}

export interface LoadedScenario {
  scenario: Scenario;
  state: RigState;
  /** Absolute paths of the profile files to seed. */
  profileFiles: string[];
  /** Other data-root files to seed: target path below the data root -> absolute source file. */
  dataFiles: { target: string; source: string }[];
  /** File mutations, with `from` made absolute. Applied by seedScenario. */
  fileMutations: FileMutation[];
  /** The rig's recorded files (fixtures/rigs/<rig>/files), mirrored into the fake home. */
  filesDir: string;
  /** http, shell and dialog scripts of the whole extends chain (the leaf's entries first). */
  scripts: Pick<Scenario, 'http' | 'shell' | 'dialogs'>;
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
  const relative = (c: { file: string }, p: string): string =>
    path.resolve(path.dirname(c.file), p);
  const mutations: Mutation[] = chain.flatMap((c) =>
    c.scenario.mutations.map((m) =>
      m.op === 'writeFile' && m.from !== undefined ? { ...m, from: relative(c, m.from) } : m
    )
  );
  const profileFiles = chain.flatMap((c) => c.scenario.profiles.map((p) => relative(c, p)));
  const dataFiles = chain.flatMap((c) =>
    Object.entries(c.scenario.data).map(([target, source]) => ({
      target,
      source: relative(c, source),
    }))
  );
  const leafFirst = [...chain].reverse();
  const rigDir = path.join(fixturesDir, 'rigs', leaf.scenario.rig);
  const rig = await loadRig(rigDir);
  return {
    scenario: leaf.scenario,
    state: applyMutations(rig, mutations),
    profileFiles,
    dataFiles,
    fileMutations: mutations.filter(isFileMutation),
    filesDir: path.join(rigDir, 'files'),
    scripts: {
      http: leafFirst.flatMap((c) => c.scenario.http),
      shell: leafFirst.flatMap((c) => c.scenario.shell),
      dialogs: {
        open: chain.flatMap((c) => c.scenario.dialogs.open),
        save: chain.flatMap((c) => c.scenario.dialogs.save),
      },
    },
  };
}

const SEEDED_MARKER = '.rigready-scenario-seeded';

export interface SeedOptions {
  /**
   * Copy only the recorded files matching these glob patterns (relative to the fake
   * user folder, e.g. 'Saved Games/DCS/**'). Without it every recorded file is copied;
   * an empty list copies none.
   */
  files?: string[];
}

/** Text files whose recorded paths are re-pointed at the fake home when the rig recorded no list. */
const REHOME_EXTENSIONS = new Set([
  '.acf',
  '.cfg',
  '.ini',
  '.json',
  '.lua',
  '.txt',
  '.vdf',
  '.xml',
  '.yaml',
]);

async function rehomeFile(file: string, home: string): Promise<void> {
  // latin1 keeps every byte as it is, whatever the file's encoding.
  const text = await fs.readFile(file, 'latin1');
  const next = rehomePaths(text, Buffer.from(home, 'utf8').toString('latin1'));
  if (next !== text) await fs.writeFile(file, next, 'latin1');
}

async function walkFiles(dir: string, visit: (file: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(full, visit);
    else await visit(full);
  }
}

/** Applies writeFile, removeFile and setSteamBuild to the fake user folder. */
export async function applyFileMutations(
  mutations: FileMutation[],
  ports: Pick<Ports, 'folders'>
): Promise<void> {
  const home = ports.folders.home();
  for (const mutation of mutations) {
    switch (mutation.op) {
      case 'writeFile': {
        const target = path.join(home, mutation.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        if (mutation.from !== undefined) await fs.copyFile(mutation.from, target);
        else await fs.writeFile(target, mutation.content ?? '');
        break;
      }
      case 'removeFile': {
        const target = path.join(home, mutation.path);
        try {
          await fs.access(target);
        } catch {
          throw new Error(`removeFile matched no file: ${mutation.path}`);
        }
        await fs.rm(target, { recursive: true, force: true });
        break;
      }
      case 'setSteamBuild': {
        const libraries = await ports.folders.steamLibraries();
        const name = `appmanifest_${mutation.appId}.acf`;
        let manifest: string | undefined;
        for (const library of libraries.ok ? libraries.value : []) {
          const candidate = path.join(library, 'steamapps', name);
          try {
            await fs.access(candidate);
            manifest = candidate;
            break;
          } catch {
            // not in this library
          }
        }
        if (!manifest) throw new Error(`setSteamBuild found no ${name} in the fake Steam library`);
        let text = await fs.readFile(manifest, 'utf8');
        const set = (key: string, value: string | number | undefined): void => {
          if (value === undefined) return;
          const line = new RegExp(`("${key}"\\s+")[^"]*(")`, 'i');
          if (line.test(text)) text = text.replace(line, `$1${value}$2`);
          else text = text.replace(/\}\s*$/, `\t"${key}"\t\t"${value}"\n}\n`);
        };
        set('buildid', mutation.buildId);
        set('StateFlags', mutation.stateFlags);
        set('TargetBuildID', mutation.targetBuildId);
        set('LastUpdated', mutation.lastUpdated);
        await fs.writeFile(manifest, text);
        break;
      }
    }
  }
}

/**
 * Puts a scenario's files where the app will look for them: the rig's recorded files
 * (Saved Games\DCS, the Steam library, AppData, ...) under the fake home with recorded
 * paths re-pointed at it, the scenario's file mutations, and its profiles and other data
 * files in the data root. A home that was seeded before is left alone, so a second start
 * on the same folders keeps what the user did.
 */
export async function seedScenario(
  loaded: LoadedScenario,
  ports: Ports,
  options: SeedOptions = {}
): Promise<void> {
  const home = ports.folders.home();
  const marker = path.join(home, SEEDED_MARKER);
  const wanted = !options.files
    ? undefined
    : options.files.length === 0
      ? () => false
      : createMatcher(options.files, undefined);
  if (!(await ports.files.exists(marker))) {
    let recorded = false;
    try {
      await fs.cp(loaded.filesDir, home, {
        recursive: true,
        force: false,
        errorOnExist: false,
        ...(wanted
          ? {
              filter: async (source: string) => {
                if ((await fs.stat(source)).isDirectory()) return true;
                return wanted(path.relative(loaded.filesDir, source));
              },
            }
          : {}),
      });
      recorded = true;
    } catch (e) {
      // The rig recorded no files.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
    if (recorded) {
      let list: string[] | undefined;
      try {
        list = z
          .array(z.string())
          .parse(await readJson(path.join(loaded.filesDir, '..', 'rehome.json')));
      } catch {
        list = undefined;
      }
      if (list) {
        for (const relative of list) {
          if (!wanted || wanted(relative)) await rehomeFile(path.join(home, relative), home);
        }
      } else {
        await walkFiles(home, async (file) => {
          if (REHOME_EXTENSIONS.has(path.extname(file).toLowerCase())) await rehomeFile(file, home);
        });
      }
    }
    await applyFileMutations(loaded.fileMutations, ports);
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(marker, '');
  }
  const seed = async (target: string, source: string, reason: string): Promise<void> => {
    if (await ports.files.exists(target)) return;
    await ports.files.write(target, await fs.readFile(source), { reason });
  };
  for (const profileFile of loaded.profileFiles) {
    await seed(
      path.join(ports.folders.dataRoot(), 'profiles', path.basename(profileFile)),
      profileFile,
      'Scenario profile'
    );
  }
  for (const { target, source } of loaded.dataFiles) {
    await seed(path.join(ports.folders.dataRoot(), target), source, 'Scenario data');
  }
}

/**
 * Changes a running fake machine: applies mutations to the live state and the fake home,
 * then tells device subscribers. Used by tests and by the app's scenario-only IPC channel.
 */
export async function applyLiveMutations(ports: FakePorts, mutations: Mutation[]): Promise<void> {
  for (const mutation of mutations) {
    if (isFileMutation(mutation)) await applyFileMutations([mutation], ports);
    else mutateState(ports.state, mutation);
  }
  ports.devices.emitChanged();
}

/**
 * Removes rigready-scenario-* folders that earlier runs left in the temp folder (and,
 * for the test harnesses, the rigready-e2e-* and rigready-test-* folders of runs that
 * were killed). Only folders older than `olderThanMs` go, so a run in progress is safe.
 */
export async function cleanupScenarioTemp(
  tempDir: string,
  now: number,
  olderThanMs = 60 * 60 * 1000,
  prefixes: string[] = ['rigready-scenario-']
): Promise<string[]> {
  const removed: string[] = [];
  let names: string[];
  try {
    names = await fs.readdir(tempDir);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!prefixes.some((prefix) => name.startsWith(prefix))) continue;
    const full = path.join(tempDir, name);
    try {
      const stat = await fs.stat(full);
      if (!stat.isDirectory() || now - stat.mtimeMs < olderThanMs) continue;
      await fs.rm(full, { recursive: true, force: true });
      removed.push(full);
    } catch {
      // In use or already gone: leave it for the next run.
    }
  }
  return removed;
}

export interface StartedScenario {
  ports: FakePorts;
  /** The scenario's description, shown in the app's scenario banner. */
  description: string;
}

/**
 * Everything a scenario run needs before the app wires its features: loads the scenario,
 * picks the fake user folder and data root, builds the fake ports and seeds the files.
 * With RIGREADY_HOME set the data root is that folder and the fake user folder is its
 * sibling "scenario-home"; without it both live in a fresh temp folder.
 */
export async function startScenario(
  scenarioFile: string,
  env: NodeJS.ProcessEnv,
  tempDir: string
): Promise<StartedScenario> {
  const file = path.resolve(scenarioFile);
  const fixturesDir = path.resolve(path.dirname(file), '..');
  const loaded = await loadScenario(file, fixturesDir);
  void cleanupScenarioTemp(tempDir, Date.now());
  const override = env['RIGREADY_HOME'];
  const home = override
    ? path.resolve(override, '..', 'scenario-home')
    : await fs.mkdtemp(path.join(tempDir, 'rigready-scenario-'));
  const dataRoot = override ? path.resolve(override) : path.join(home, '.rigready');
  const fromEnv = dialogScriptFromEnv(env);
  const ports = createFakePorts({
    state: loaded.state,
    homeDir: home,
    dataRoot,
    scenario: {
      ...loaded.scripts,
      dialogs: {
        open: [...fromEnv.open, ...loaded.scripts.dialogs.open],
        save: [...fromEnv.save, ...loaded.scripts.dialogs.save],
      },
    },
  });
  await seedScenario(loaded, ports);
  return { ports, description: loaded.scenario.description };
}
