import type { Result } from '../result';
import type {
  AudioRole,
  AudioState,
  DeviceInfo,
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

/** Everything that touches the machine goes through one of these interfaces. */

export interface DeviceProvider {
  /** Physical USB devices currently present, with identity and hub chain. */
  list(): Promise<Result<DeviceInfo[]>>;
  /**
   * Calls the listener when a device was plugged in or removed (it says only that
   * something changed; call list() again). Returns the unsubscribe function.
   */
  subscribe(listener: () => void): () => void;
}

/**
 * The DirectInput controllers a game sees and their live state. One reader serves the
 * whole app.
 *
 * Lifetime rule: a feature calls start() every time it needs controllers and never calls
 * stop(). start() is idempotent: when the reader is running it answers at once with the
 * current controllers, calls made while it is starting share that one start, and after a
 * failed start the next call tries again. Only the app shell stops the reader, on quit
 * (src/main/index.ts). A feature that listens to live input unsubscribes when it is done;
 * that is all the cleaning up it does.
 */
export interface InputProvider {
  /**
   * Makes sure the DirectInput reader runs. Resolves with the controllers a game would see
   * right now. Cheap when it is already running; safe to call from several features at once.
   */
  start(): Promise<Result<InputDevice[]>>;
  /** Ends the reader. For the app shell on quit only; a start() after it starts a new reader. */
  stop(): Promise<void>;
  devices(): InputDevice[];
  /**
   * Live state changes. A new subscriber is first given the last known state of every
   * device. Returns an unsubscribe function.
   */
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

export interface CloseOptions {
  /** How long to wait for the program to exit after asking it to close. Default 10 000. */
  waitMs?: number;
  /** Terminate the program when it has not exited in time. Default false. */
  force?: boolean;
}

export interface ProcessProvider {
  list(): Promise<Result<ProcessInfo[]>>;
  /** Starts a program detached from RigReady. Never goes through a shell. */
  start(target: LaunchTarget): Promise<Result<{ pid: number | undefined }>>;
  /** Terminates a program immediately. Prefer close(). */
  stop(pid: number): Promise<Result<void>>;
  /**
   * Asks a program to close the way its window's X button does, waits for it to exit,
   * and only terminates it when `force` is set. Fails with `process.stillRunning` when
   * it did not exit and force is off.
   */
  close(pid: number, options?: CloseOptions): Promise<Result<{ outcome: 'closed' | 'terminated' }>>;
}

export interface ServiceProvider {
  /** Every Windows service with its current state. No admin rights needed. */
  list(): Promise<Result<ServiceInfo[]>>;
  /** One service by its short name (case-insensitive); undefined when it is not installed. */
  get(name: string): Promise<Result<ServiceInfo | undefined>>;
}

export interface AudioProvider {
  read(): Promise<Result<AudioState>>;
  /**
   * Makes an endpoint the default for its flow (playback or recording). Without `roles`
   * all three roles are set, which is what "Set as default device" does in Windows.
   * Resolves with the state read back afterwards.
   */
  setDefault(id: string, options?: { roles?: AudioRole[] }): Promise<Result<AudioState>>;
}

/** Read-only access to the Windows registry. */
export interface Registry {
  /** One value; undefined when the key or the value does not exist. */
  getValue(
    hive: RegistryHive,
    key: string,
    name: string
  ): Promise<Result<RegistryValue | undefined>>;
  /** Names of the sub-keys of a key. Empty when the key does not exist. */
  listKeys(hive: RegistryHive, key: string): Promise<Result<string[]>>;
  /** Every value of a key by name. Empty when the key does not exist. */
  listValues(hive: RegistryHive, key: string): Promise<Result<Record<string, RegistryValue>>>;
}

export interface KnownFolders {
  home(): string;
  documents(): string;
  savedGames(): string;
  appData(): string;
  localAppData(): string;
  /** C:\Program Files */
  programFiles(): string;
  /** C:\Program Files (x86) */
  programFilesX86(): string;
  /** C:\ProgramData */
  programData(): string;
  /** C:\Windows: where Windows' own programs are (explorer.exe). */
  windows(): string;
  /** RigReady's own data folder. Honors RIGREADY_HOME. */
  dataRoot(): string;
  /** This PC's name, for saying where a backup was made and for keeping it out of shared files. */
  machineName(): string;
  /** Every Steam library folder (from libraryfolders.vdf). Empty when Steam is absent. */
  steamLibraries(): Promise<Result<string[]>>;
}

export interface ShellResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface ShellOptions {
  cwd?: string;
  /**
   * Extra environment variables for the program, added to RigReady's own environment.
   * This is how values from a setup reach a script: as variables, never as command text.
   */
  env?: Record<string, string>;
  /**
   * No console window. Default true for run(); launch() shows the program's window unless
   * this is set.
   */
  hidden?: boolean;
}

export interface Shell {
  /** Runs a program to completion. Executable plus argument array; no shell is involved. */
  run(
    exe: string,
    args: string[],
    options?: ShellOptions & { timeoutMs?: number }
  ): Promise<Result<ShellResult>>;
  /** Starts a program and leaves it running after RigReady exits. */
  launch(
    exe: string,
    args: string[],
    options?: ShellOptions
  ): Promise<Result<{ pid: number | undefined }>>;
}

export interface Clock {
  now(): Date;
}

/** Small named secrets (the user's Anthropic API key), encrypted at rest for this Windows user. */
export interface Secrets {
  get(name: string): Promise<Result<string | undefined>>;
  set(name: string, value: string): Promise<Result<void>>;
  remove(name: string): Promise<Result<void>>;
}

export interface HttpRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** https only. */
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /** Default 60 000. */
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  /** Header names in lower case. */
  headers: Record<string, string>;
  body: string;
}

/** A minimal fetch, so network calls (the AI features) can be scripted in tests. */
export interface Http {
  /** Resolves with the response for any HTTP status; fails only when no response arrived. */
  request(request: HttpRequest): Promise<Result<HttpResponse>>;
}

export interface FileFilter {
  name: string;
  /** Without the dot, e.g. ['rigready', 'zip']. */
  extensions: string[];
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: FileFilter[];
  /** Pick a folder instead of a file. */
  directory?: boolean;
  multiple?: boolean;
}

export interface SaveDialogOptions {
  title?: string;
  /** Suggested folder and/or file name. */
  defaultPath?: string;
  filters?: FileFilter[];
}

/** Native file pickers. A path the user picked here is one RigReady may read or write. */
export interface Dialogs {
  /** The chosen paths; empty when the user cancelled. */
  open(options?: OpenDialogOptions): Promise<Result<string[]>>;
  /** The chosen path; null when the user cancelled. */
  save(options?: SaveDialogOptions): Promise<Result<string | null>>;
}

/** Turns HTML into an image or a document (cheat sheets, kneeboard pages). No scripts run. */
export interface Render {
  /** A PNG of exactly width x height pixels. */
  png(html: string, size: { width: number; height: number }): Promise<Result<Uint8Array>>;
  pdf(
    html: string,
    options?: { pageSize?: 'A4' | 'Letter'; landscape?: boolean }
  ): Promise<Result<Uint8Array>>;
}

export interface Notifications {
  /** Shows an OS notification (tray balloon). */
  notify(message: { title: string; body: string }): Promise<Result<void>>;
}

export interface Clipboard {
  /** Puts text on the Windows clipboard. */
  writeText(text: string): Promise<Result<void>>;
}

export interface ScreenLabel {
  /** Desktop coordinates of the monitor the label is shown on. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Large text, e.g. "2". */
  text: string;
  /** Smaller line below it, e.g. the monitor's name. */
  caption?: string;
  /**
   * Draws an arrow pointing to the top of the picture. On a monitor that is mounted
   * turned, the arrow points up only when Windows has it rotated the right way.
   */
  up?: boolean;
}

/** Short-lived labels drawn on top of everything, one per monitor ("Identify"). */
export interface Overlays {
  /** Shows the labels and removes them after durationMs. Showing new labels replaces the old ones. */
  showLabels(labels: ScreenLabel[], durationMs: number): Promise<Result<void>>;
}

export interface ScreenArea {
  /** Desktop coordinates in pixels, as DisplayProvider reports monitors. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** RigReady's own window, for the one thing features need of it: being where the user can see it. */
export interface AppWindow {
  /**
   * Shows the window (restored from the tray or the taskbar) on one of these areas. When
   * it is not already on one of them it is moved to the first, resized to fit. Used
   * before and after a monitor layout change, so the "Keep this layout?" question is
   * never on a screen that just went dark.
   */
  showOn(areas: ScreenArea[]): Promise<Result<{ moved: boolean }>>;
}

/** The per-user "start with Windows" entry. */
export interface LoginItem {
  isEnabled(): Promise<Result<boolean>>;
  setEnabled(enabled: boolean): Promise<Result<void>>;
}

/** The update channels a user can follow. */
export type UpdateChannel = 'stable' | 'beta';

/** A version the update feed offers. */
export interface UpdateOffer {
  version: string;
  notes?: string;
}

/**
 * Where new versions of RigReady come from (GitHub Releases in the installed app). The
 * port only fetches and installs; when to do either is decided by the updates feature.
 */
export interface UpdateFeed {
  /** The version that is running. */
  currentVersion(): string;
  /** Why updating cannot work in this run (a development run), or undefined when it can. */
  unavailable(): string | undefined;
  /** The newest version published on the channel, newer than this one or not; null when nothing is published. */
  check(channel: UpdateChannel): Promise<Result<UpdateOffer | null>>;
  /** Downloads what the last check found. Installs nothing. */
  download(onProgress: (percent: number) => void): Promise<Result<void>>;
  /** Whether the downloaded update is installed when RigReady quits. Off until told otherwise. */
  setInstallOnQuit(on: boolean): void;
  /** Quits RigReady, installs the downloaded update and starts the new version. */
  quitAndInstall(): Promise<Result<void>>;
}

export interface RawStat {
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

/** Minimal file-system access. Only FileStore and platform code use it directly. */
export interface RawFs {
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, data: Uint8Array | string): Promise<void>;
  appendText(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** Undefined when the path does not exist. */
  stat(path: string): Promise<RawStat | undefined>;
  mkdirp(path: string): Promise<void>;
  /** Names of the entries in a directory. Empty when it does not exist. */
  list(path: string): Promise<string[]>;
  copyFile(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Removes a directory and everything in it. */
  removeDir(path: string): Promise<void>;
  /** Removes a directory only when it is empty. False when it holds something or is not there. */
  removeEmptyDir(path: string): Promise<boolean>;
}

export interface FileEntry {
  name: string;
  /** Absolute path. */
  path: string;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

export interface TreeEntry extends FileEntry {
  /** Path below the listed folder, with forward slashes: "Config/Input/a.lua". */
  relativePath: string;
}

export interface TreeOptions {
  /**
   * Glob patterns on the relative path (forward slashes, case-insensitive): `*` within
   * a name, `**` across folders, `?` one character. A pattern without a slash matches
   * the file name at any depth. Without `include` every file is included.
   */
  include?: string[];
  exclude?: string[];
  /** Stop with an error beyond this many files. Default 20 000. */
  maxEntries?: number;
}

/** Several file changes that belong to one user action and are undone together. */
export interface ChangeGroup {
  id: string;
  reason: string;
}

export interface ChangeOptions {
  /** Why, in words the user can read. */
  reason: string;
  /** From beginGroup(): makes this change part of a multi-file action. */
  group?: ChangeGroup;
  /**
   * Back up and journal the change even inside the data root, where changes are
   * otherwise plain writes (e.g. deleting a profile, so it can be undone).
   */
  journal?: boolean;
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
  /** sha256 of the content that was replaced. Null when the file did not exist before. */
  hashBefore?: string | null;
  /** sha256 of the content this change left behind. Null for a removal. */
  hashAfter?: string | null;
  /** The action this change belongs to. A single change is an action of its own (its id). Absent only in journals written before that. */
  groupId?: string;
  groupReason?: string;
  /** Set on an entry that was itself written by undoing another one. */
  undoOf?: string;
  /**
   * Folders this change had to create for its file, innermost first. Undoing the change
   * removes the ones that are empty again, and never any other folder.
   */
  createdDirs?: string[];
  undone: boolean;
}

/** One user action in the journal: a single change, or everything done under beginGroup(). */
export interface JournalGroup {
  id: string;
  time: string;
  reason: string;
  entries: JournalEntry[];
  /** True when every entry has been undone. */
  undone: boolean;
}

export interface UndoOptions {
  /** Undo even when the file was changed again after the journaled change. */
  force?: boolean;
}

export interface FileStore {
  readText(path: string): Promise<Result<string>>;
  readBytes(path: string): Promise<Result<Uint8Array>>;
  exists(path: string): Promise<boolean>;
  /** Undefined when the path does not exist. */
  stat(path: string): Promise<Result<FileEntry | undefined>>;
  /** Entry names of a folder. Empty when it does not exist. */
  list(dir: string): Promise<Result<string[]>>;
  /** Entries of a folder with size, modified time and kind. Empty when it does not exist. */
  listEntries(dir: string): Promise<Result<FileEntry[]>>;
  /** Every file below a folder (no directory entries), filtered by glob patterns. */
  listTree(dir: string, options?: TreeOptions): Promise<Result<TreeEntry[]>>;
  /** Creates a folder and its parents. Not journaled: an empty folder changes nothing. */
  mkdir(dir: string): Promise<Result<void>>;
  /**
   * Writes a file. Outside the data root the previous content is snapshotted first
   * and the change is journaled; the journal entry is returned. Inside the data
   * root the result is null.
   */
  write(
    path: string,
    content: string | Uint8Array,
    options: ChangeOptions
  ): Promise<Result<JournalEntry | null>>;
  remove(path: string, options: ChangeOptions): Promise<Result<JournalEntry | null>>;
  /** Copies one file; the destination is backed up and journaled like write(). */
  copy(from: string, to: string, options: ChangeOptions): Promise<Result<JournalEntry | null>>;
  /**
   * Moves or renames one file: the destination is written and the source removed, as
   * two journal entries of one group (the given one, or a new one).
   */
  move(from: string, to: string, options: ChangeOptions): Promise<Result<ChangeGroup>>;
  /**
   * Copies a folder tree (filtered like listTree). Every file written is one journal
   * entry in one group, so the whole copy is undone together.
   */
  copyTree(
    fromDir: string,
    toDir: string,
    options: ChangeOptions & TreeOptions
  ): Promise<Result<{ group: ChangeGroup; files: string[] }>>;
  /** Starts a multi-file action. Pass the group to every write, remove and copy that belongs to it. */
  beginGroup(reason: string): ChangeGroup;
  journal(): Promise<Result<JournalEntry[]>>;
  /** The journal by user action, newest first. */
  journalGroups(): Promise<Result<JournalGroup[]>>;
  /**
   * Puts back what a journaled change replaced. The undo is itself journaled. Fails
   * with `journal.changed` when the file was modified since, unless `force` is set.
   */
  undo(entryId: string, options?: UndoOptions): Promise<Result<JournalEntry>>;
  /** Undoes every change of a group, newest first. */
  undoGroup(groupId: string, options?: UndoOptions): Promise<Result<JournalGroup>>;
  /**
   * Deletes automatic backups that are both older than `days` and not among the newest
   * `groups` actions, with their journal entries.
   */
  prune(keep: {
    days: number;
    groups: number;
  }): Promise<Result<{ removedGroups: number; freedBytes: number }>>;
  /** Bytes used by automatic backups. */
  backupBytes(): Promise<Result<number>>;
}

export interface LogSink {
  write(line: string): void;
}

export interface Ports {
  devices: DeviceProvider;
  input: InputProvider;
  displays: DisplayProvider;
  processes: ProcessProvider;
  services: ServiceProvider;
  audio: AudioProvider;
  registry: Registry;
  files: FileStore;
  folders: KnownFolders;
  shell: Shell;
  clock: Clock;
  secrets: Secrets;
  http: Http;
  dialogs: Dialogs;
  render: Render;
  notifications: Notifications;
  clipboard: Clipboard;
  loginItem: LoginItem;
  overlays: Overlays;
  window: AppWindow;
  updates: UpdateFeed;
}
