import type { Result } from '../result';
import type {
  AudioState,
  DeviceInfo,
  DisplayLayout,
  DisplayTarget,
  InputDevice,
  InputState,
  LaunchTarget,
  ProcessInfo,
} from '../../shared/models';

/** Everything that touches the machine goes through one of these interfaces. */

export interface DeviceProvider {
  /** Physical USB devices currently present, with identity and hub chain. */
  list(): Promise<Result<DeviceInfo[]>>;
}

export interface InputProvider {
  /** Starts the DirectInput reader. Resolves with the devices a game would see. */
  start(): Promise<Result<InputDevice[]>>;
  stop(): Promise<void>;
  devices(): InputDevice[];
  /** Live state changes. Returns an unsubscribe function. */
  subscribe(listener: (states: InputState[]) => void): () => void;
}

export interface DisplayApplyOutcome {
  previous: DisplayLayout;
  current: DisplayLayout;
}

export interface DisplayProvider {
  /** Every connected monitor, enabled or not. */
  read(): Promise<Result<DisplayLayout>>;
  /**
   * Applies the targets. Displays not mentioned are left as they are. The prior
   * configuration is captured first so revert() can restore it.
   */
  apply(targets: DisplayTarget[]): Promise<Result<DisplayApplyOutcome>>;
  /** True when a configuration captured by apply() is available. */
  canRevert(): boolean;
  /** Restores the configuration captured by the most recent apply(). */
  revert(): Promise<Result<DisplayLayout>>;
}

export interface ProcessProvider {
  list(): Promise<Result<ProcessInfo[]>>;
  /** Starts a program detached from RigReady. Never goes through a shell. */
  start(target: LaunchTarget): Promise<Result<{ pid: number | undefined }>>;
  stop(pid: number): Promise<Result<void>>;
}

export interface AudioProvider {
  read(): Promise<Result<AudioState>>;
}

export interface KnownFolders {
  home(): string;
  documents(): string;
  savedGames(): string;
  appData(): string;
  localAppData(): string;
  /** RigReady's own data folder. Honors RIGREADY_HOME. */
  dataRoot(): string;
  /** Every Steam library folder (from libraryfolders.vdf). Empty when Steam is absent. */
  steamLibraries(): Promise<Result<string[]>>;
}

export interface ShellResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface Shell {
  /** Runs a program to completion. Executable plus argument array; no shell is involved. */
  run(
    exe: string,
    args: string[],
    options?: { cwd?: string; timeoutMs?: number }
  ): Promise<Result<ShellResult>>;
  /** Starts a program and leaves it running after RigReady exits. */
  launch(
    exe: string,
    args: string[],
    options?: { cwd?: string }
  ): Promise<Result<{ pid: number | undefined }>>;
}

export interface Clock {
  now(): Date;
}

/** Minimal file-system access. Only FileStore and platform code use it directly. */
export interface RawFs {
  readText(path: string): Promise<string>;
  writeBytes(path: string, data: Uint8Array | string): Promise<void>;
  appendText(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdirp(path: string): Promise<void>;
  /** Names of the entries in a directory. Empty when it does not exist. */
  list(path: string): Promise<string[]>;
  copyFile(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface JournalEntry {
  id: string;
  time: string;
  /** The file that was changed. */
  path: string;
  action: 'write' | 'remove';
  /** Why, in words the user can read. */
  reason: string;
  /** Snapshot of the previous content. Null when the file did not exist before. */
  backupPath: string | null;
  undone: boolean;
}

export interface FileStore {
  readText(path: string): Promise<Result<string>>;
  exists(path: string): Promise<boolean>;
  list(dir: string): Promise<Result<string[]>>;
  /**
   * Writes a file. Outside the data root the previous content is snapshotted first
   * and the change is journaled; the journal entry is returned. Inside the data
   * root the result is null.
   */
  write(
    path: string,
    content: string | Uint8Array,
    options: { reason: string }
  ): Promise<Result<JournalEntry | null>>;
  remove(path: string, options: { reason: string }): Promise<Result<JournalEntry | null>>;
  journal(): Promise<Result<JournalEntry[]>>;
  /** Puts back what a journaled change replaced. */
  undo(entryId: string): Promise<Result<JournalEntry>>;
}

export interface LogSink {
  write(line: string): void;
}

export interface Ports {
  devices: DeviceProvider;
  input: InputProvider;
  displays: DisplayProvider;
  processes: ProcessProvider;
  audio: AudioProvider;
  files: FileStore;
  folders: KnownFolders;
  shell: Shell;
  clock: Clock;
}
