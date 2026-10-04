import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  shell,
  Tray,
} from 'electron';
import path from 'node:path';
import { z } from 'zod';
import trayIconPath from '../../assets/icon.ico?asset';
import { parseCommandLine, type ParsedCommandLine } from '../core/commandLine';
import { startupNotices } from '../core/dataHealth';
import { bind } from '../core/feature';
import type { Logger } from '../core/logger';
import { isWithin } from '../core/paths';
import type { FileStore, Ports } from '../core/ports';
import { err, ok } from '../core/result';
import {
  APP_USER_MODEL_ID,
  ElectronAppWindow,
  ElectronClipboard,
  ElectronDialogs,
  ElectronLoginItem,
  ElectronNotifications,
  ElectronOverlays,
  ElectronRender,
  ElectronSecrets,
  ElectronShortcuts,
  ElectronTaskbar,
  HIDDEN_ARG,
} from '../platform/electron';
import { ElectronUpdateFeed } from '../platform/electron/updater';
import { applyLiveMutations, startScenario, type FakePorts } from '../platform/fake';
import { pngSize } from '../platform/fake/png';
import { MutationSchema } from '../platform/fake/scenario';
import { systemClock } from '../platform/node';
import { createWindowsPorts } from '../platform/windows';
import { trimWorkingSets } from '../platform/windows/memory';
import { appContract } from '../shared/appContract';
import { eventName } from '../shared/channels';
import type { Envelope } from '../shared/ipc';
import { discoverFeatures, wireFeatures } from './bootstrap';
import { runDiagnose } from './diagnose';
import { unsupportedPlatformMessage } from './platformGuard';
import { CommandRunner } from './rigCommand';
import {
  TaskbarActivity,
  TaskbarTold,
  jumpTasks,
  taskbarOverlay,
  taskbarTooltip,
  thumbButtons,
} from './taskbarModel';
import { TrayMemoryTrimmer } from './trayMemory';
import {
  installProcessErrorHooks,
  logReportedErrors,
  reportStartFailure,
  watchWindow,
} from './errorHooks';
import { startLogging } from './logging';
import {
  paintBadge,
  statusFromFlyResponse,
  TONE_RGB,
  trayClick,
  trayMenu,
  trayStatusLine,
  trayTone,
  trayTooltip,
  type TrayMenuItem,
  type TrayStatus,
  type TrayWindowState,
} from './trayModel';

/**
 * Electron bootstrap. Thin: pick the platform (real machine or scenario), wire the
 * features, open the window, keep the tray.
 */

const projectRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
const resourcesPath = app.isPackaged ? process.resourcesPath : undefined;
let mainWindow: BrowserWindow | undefined;
// Module-level so the tray icon is not garbage collected.
let tray: Tray | undefined;
let quitting = false;
// Exists before the data root is known; what is logged until then is written once the file opens.
const logging = startLogging(systemClock);

/** Loads the renderer in a window, on a route when given (the main window starts at the root). */
function loadApp(window: BrowserWindow, route?: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void window.loadURL(route ? `${devUrl}#${route}` : devUrl);
  else {
    void window.loadFile(
      path.join(__dirname, '../renderer/index.html'),
      route ? { hash: route } : undefined
    );
  }
}

/** The app's own windows: the main one, and small panels a feature opens (quick-look sheets). */
const appWindow = new ElectronAppWindow(() => mainWindow, {
  preload: path.join(__dirname, '../preload/index.js'),
  load: loadApp,
});

/** The real taskbar button, kept here so it can follow the main window once there is one. */
let realTaskbar: ElectronTaskbar | undefined;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

interface Platform {
  ports: Ports;
  scenario?: string;
  /** Present in scenario runs: the fake machine, for live mutations. */
  fake?: FakePorts;
}

async function createPlatform(): Promise<Platform> {
  const scenarioFile = process.env['RIGREADY_SCENARIO'];
  if (!scenarioFile) {
    return {
      ports: createWindowsPorts({
        log: logging.log,
        projectRoot,
        ...(resourcesPath ? { resourcesPath } : {}),
        app: (dataRoot) => {
          const shortcuts = new ElectronShortcuts(dataRoot);
          realTaskbar = new ElectronTaskbar(
            () => mainWindow,
            () => shortcuts.self()
          );
          return {
            secrets: new ElectronSecrets(dataRoot),
            dialogs: new ElectronDialogs(() => mainWindow),
            render: new ElectronRender(dataRoot),
            notifications: new ElectronNotifications(),
            clipboard: new ElectronClipboard(),
            loginItem: new ElectronLoginItem(),
            overlays: new ElectronOverlays(),
            window: appWindow,
            updates: new ElectronUpdateFeed(logging.log.child('updater')),
            shortcuts,
            taskbar: realTaskbar,
          };
        },
      }),
    };
  }
  // Scenario runs never use the real profile: without RIGREADY_HOME they get a temp folder.
  const started = await startScenario(scenarioFile, process.env, app.getPath('temp'));
  const fake = started.ports;
  // The fake update feed never touches the network; it reports this build's version.
  fake.updates.version = app.getVersion();
  const dataRoot = fake.folders.dataRoot();
  // Encryption and HTML rendering do not depend on the rig, so scenario runs use the real
  // ones (inside the temp data root). Everything that describes or changes the machine is fake.
  const ports: Ports = {
    ...fake,
    secrets: new ElectronSecrets(dataRoot),
    render: new ElectronRender(dataRoot),
    // Panels are RigReady's own windows, not the machine: a scenario run opens real ones.
    window: {
      showOn: (areas) => fake.window.showOn(areas),
      openPanel: (panel) => appWindow.openPanel(panel),
    },
  };
  return { ports, scenario: started.description, fake };
}

const WindowStateSchema = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(960),
  height: z.number().int().min(640),
  maximized: z.boolean().default(false),
});
type WindowState = z.infer<typeof WindowStateSchema>;

async function readWindowState(files: FileStore, file: string): Promise<WindowState> {
  const fallback: WindowState = { width: 1280, height: 860, maximized: false };
  try {
    const text = await files.readText(file);
    if (!text.ok) return fallback;
    const state = WindowStateSchema.parse(JSON.parse(text.value));
    if (state.x === undefined || state.y === undefined) return state;
    // Only reuse a position that is still on a connected screen.
    const visible = screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      return (
        state.x! + 80 < area.x + area.width &&
        state.x! + state.width - 80 > area.x &&
        state.y! >= area.y - 10 &&
        state.y! + 40 < area.y + area.height
      );
    });
    return visible
      ? state
      : { width: state.width, height: state.height, maximized: state.maximized };
  } catch {
    // A damaged window.json: the window opens at its default size and the file is rewritten on the next move.
    return fallback;
  }
}

function createWindow(
  state: WindowState,
  files: FileStore,
  stateFile: string,
  show: boolean
): BrowserWindow {
  const window = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0f1317',
    show: false,
    autoHideMenuBar: true,
    title: 'RigReady',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (state.maximized) window.maximize();
  window.once('ready-to-show', () => {
    windowDrawn = true;
    if (show) window.show();
  });
  // Links never open inside the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const save = (): void => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (window.isDestroyed() || window.isMinimized()) return;
      const bounds = window.getNormalBounds();
      const next: WindowState = { ...bounds, maximized: window.isMaximized() };
      // Inside the data root, so this is a plain write with no journal entry.
      void files.write(stateFile, JSON.stringify(next, null, 2), { reason: 'Window position' });
    }, 400);
  };
  window.on('resize', save);
  window.on('move', save);
  window.on('maximize', save);
  window.on('unmaximize', save);

  loadApp(window);
  return window;
}

/** False until the window has drawn its first frame: showing it earlier shows an empty one. */
let windowDrawn = false;

function showWindow(): void {
  if (!mainWindow) return;
  if (!windowDrawn) {
    const window = mainWindow;
    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) showWindow();
    });
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** What this start was asked to do (--fly, --make-ready, --setup), read before anything else. */
const startCommand = parseCommandLine(process.argv);
/** What a second start handed over before this one had finished starting. */
let handedOver: ParsedCommandLine | undefined;
/** Set once the features are wired: runs what a start asks for. */
let runCommand: ((parsed: ParsedCommandLine) => void) | undefined;

/** A second start (a desktop shortcut, a Jump List task) while RigReady is already running. */
function onSecondInstance(argv: string[], handed: unknown): void {
  // The second start read its own arguments and sent what it found: Chromium may reorder
  // the raw ones it passes along, which would part a flag from its setup.
  const sent = (handed as { command?: ParsedCommandLine } | null | undefined)?.command;
  const parsed = sent && typeof sent.kind === 'string' ? sent : parseCommandLine(argv);
  if (parsed.kind === 'none') showWindow();
  else if (runCommand) runCommand(parsed);
  else handedOver = parsed;
}

async function start(): Promise<void> {
  const diagnoseFile = argValue('--diagnose');
  if (diagnoseFile) {
    // Headless: enumerate the real machine, write JSON, exit. Used by support and the packaged smoke test.
    const code = await runDiagnose(path.resolve(diagnoseFile), {
      projectRoot,
      ...(resourcesPath ? { resourcesPath } : {}),
    });
    app.exit(code);
    return;
  }

  app.setAppUserModelId(APP_USER_MODEL_ID);
  const { ports, scenario, fake } = await createPlatform();
  const dataRoot = ports.folders.dataRoot();
  logging.open(dataRoot, [ports.folders.home()]);
  const log: Logger = logging.log;
  logReportedErrors(log);
  log.info(`RigReady ${app.getVersion()} starting`, { scenario: scenario ?? null, dataRoot });

  const send = (channel: string, payload: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    for (const panel of appWindow.panels()) panel.webContents.send(channel, payload);
    // A command started from outside the window follows the progress the features report.
    commands.onEvent(channel, payload);
    // So does the taskbar button; and a setup made, renamed or deleted changes its Jump List.
    if (activity.event(channel, payload)) refreshTaskbar();
    if (channel === SETUPS_CHANGED) refreshSetups();
  };
  /** What is running right now, for the progress bar in the taskbar button. */
  const activity = new TaskbarActivity();
  const SETUPS_CHANGED = eventName('fly', 'profilesChanged');
  // Commands: --fly, --make-ready, --setup (a shortcut, a Jump List task, a second start).
  // What it works with is defined further down; nothing here runs before that.
  const commands = new CommandRunner({
    call: (channel, input) => call(channel, input),
    publish: (run) => send(eventName(appContract.feature, 'command'), run),
    showWindow,
    flyChanged: () => flyChanged(),
    busy: () => trayBusy || activity.busy(),
    working: (on) => {
      trayBusy = on;
      refreshTray();
    },
  });
  const machineChanged = (reason: string): void =>
    send(eventName(appContract.feature, 'machineChanged'), { reason });

  // A device was plugged in or removed: every screen that shows machine state refreshes.
  let deviceTimer: ReturnType<typeof setTimeout> | undefined;
  ports.devices.subscribe(() => {
    clearTimeout(deviceTimer);
    deviceTimer = setTimeout(() => machineChanged('devices'), 400);
  });

  const wiring = wireFeatures({ features: discoverFeatures(), ports, log, send });
  const { settings } = wiring.context;

  const notices: string[] = [];
  const loaded = await settings.get();
  const current = loaded.ok ? loaded.value : undefined;
  if (!loaded.ok) notices.push(`${loaded.error.message} ${loaded.error.detail ?? ''}`.trim());
  const settingsNotice = settings.takeNotice();
  if (settingsNotice) {
    notices.push(settingsNotice);
    log.warn(settingsNotice);
  }
  await logging.follow(settings);
  notices.push(...(await startupNotices({ ...wiring.context, log })));
  if (current) {
    const pruned = await ports.files.prune({
      days: current.retention.autoBackupDays,
      groups: current.retention.autoBackupGroups,
    });
    if (pruned.ok && pruned.value.removedGroups > 0) {
      log.info('removed old automatic backups', pruned.value);
    } else if (!pruned.ok) {
      log.warn('could not prune automatic backups', pruned.error);
    }
  }

  // Scenario runs keep a fake overlay port; this one lets a test show the real labels.
  const realOverlays = new ElectronOverlays();
  const appBinding = bind(appContract, {
    info: async () =>
      ok({
        version: app.getVersion(),
        dataRoot,
        features: wiring.features.map((f) => f.id),
        notices,
        ...(scenario ? { scenario } : {}),
      }),
    command: async () => ok(commands.state()),
    cancelCommand: async () => ok({ cancelled: commands.cancel() }),
    scenario: async ({ mutations, input, change, render, labels }) => {
      if (!fake) return err('scenario.off', 'This only works in a scenario run.');
      const parsed = z.array(MutationSchema).safeParse(mutations);
      if (!parsed.success) {
        return err('scenario.invalid', 'Invalid mutation.', z.prettifyError(parsed.error));
      }
      try {
        await applyLiveMutations(fake, parsed.data);
      } catch (e) {
        return err('scenario.mutation', e instanceof Error ? e.message : String(e));
      }
      if (input.length > 0) fake.input.emit(input);
      if (change) {
        const group = ports.files.beginGroup(change.reason);
        for (const file of change.files) {
          const target = path.resolve(ports.folders.home(), file.path);
          if (!isWithin(ports.folders.home(), target)) {
            return err('scenario.invalid', 'A changed file must be inside the fake user folder.');
          }
          const written = await ports.files.write(target, file.content, {
            reason: change.reason,
            group,
          });
          if (!written.ok) return written;
        }
      }
      if (labels) {
        const shown = await realOverlays.showLabels(
          labels.items.map(({ caption, ...label }) => ({
            ...label,
            ...(caption ? { caption } : {}),
          })),
          labels.durationMs
        );
        if (!shown.ok) return shown;
      }
      if (parsed.data.length > 0 || change) machineChanged('scenario');
      if (!render) return ok({ applied: parsed.data.length });
      const png = await ports.render.png(render.html, render);
      if (!png.ok) return png;
      const pdf = await ports.render.pdf(render.html);
      if (!pdf.ok) return pdf;
      const size = pngSize(png.value) ?? { width: 0, height: 0 };
      return ok({
        applied: parsed.data.length,
        render: {
          pngBytes: png.value.length,
          pngWidth: size.width,
          pngHeight: size.height,
          pdfBytes: pdf.value.length,
          pdfHeader: new TextDecoder().decode(pdf.value.subarray(0, 5)),
        },
      });
    },
  });
  const appWiring = wireFeatures({
    features: [{ id: 'app', setup: () => [appBinding] }],
    ports,
    log,
    send,
  });

  // ---- tray ----
  let trayStatus: TrayStatus = {};
  let trayBusy = false;
  /** Calls after which the list of setups, or which one was used last, may be different. */
  const SETUP_CHANGERS = new Set([
    'fly:check',
    'profiles:create',
    'profiles:save',
    'profiles:remove',
    'profiles:clone',
    'profiles:use',
    'sharing:import',
  ]);
  const handlers = new Map([...wiring.handlers, ...appWiring.handlers]);
  const call = async (channel: string, input?: unknown): Promise<Envelope> => {
    const handler = handlers.get(channel);
    if (!handler) return err('ipc.unknown', `Unknown channel ${channel}.`);
    // Make ready, Launch, Stand down and checks show on the taskbar button, whoever asked.
    if (activity.began(channel, input)) refreshTaskbar();
    let envelope: Envelope;
    try {
      envelope = await handler(input);
    } finally {
      if (activity.ended(channel, input)) refreshTaskbar();
    }
    // The quiet re-check the Fly screen makes every few seconds changes neither.
    const quiet = (input as { remember?: unknown } | undefined)?.remember === false;
    if (envelope.ok && SETUP_CHANGERS.has(channel) && !quiet) refreshSetups();
    if (envelope.ok) {
      const next = statusFromFlyResponse(channel, envelope.value, trayStatus);
      if (next) {
        trayStatus = next;
        refreshTray();
      }
      // After a launch the window gets out of the way, when the user wants that.
      if (channel === 'fly:launch') {
        const value = envelope.value as { outcome?: string; minimize?: boolean };
        if (value.outcome === 'launched' && value.minimize && mainWindow) {
          if (tray) mainWindow.hide();
          else mainWindow.minimize();
        }
      }
    }
    return envelope;
  };

  const quit = (): void => {
    quitting = true;
    app.quit();
  };

  /** The Fly screen picks up a setup switched or acted on from the tray. */
  const flyChanged = (): void => {
    send(eventName('fly', 'profilesChanged'), { ids: [] });
    machineChanged('tray');
  };

  /**
   * Reads the setups again, a moment after the last thing that may have changed them: the
   * quick switch of the tray and the Jump List follow setups made, renamed, deleted and used.
   */
  let setupsTimer: ReturnType<typeof setTimeout> | undefined;
  function refreshSetups(): void {
    clearTimeout(setupsTimer);
    setupsTimer = setTimeout(() => void call('fly:state'), 250);
  }

  const fromTray = async (
    work: (profileId: string, name: string) => Promise<void>
  ): Promise<void> => {
    if (trayBusy || activity.busy() || !trayStatus.profileId) return;
    trayBusy = true;
    refreshTray();
    try {
      await work(trayStatus.profileId, trayStatus.profileName ?? 'Setup');
    } finally {
      trayBusy = false;
      refreshTray();
      flyChanged();
    }
  };

  const trayActions: Record<string, () => Promise<void> | void> = {
    open: showWindow,
    quit,
    makeReady: () =>
      fromTray(async (profileId, name) => {
        // Tagged, so its fixes are reported one by one and the taskbar button can fill.
        const result = await call('fly:makeReady', { profileId, runId: `tray-${Date.now()}` });
        await ports.notifications.notify(
          result.ok
            ? {
                title: trayStatus.ready ? `${name} is ready` : `${name} is not ready`,
                body: trayStatus.ready
                  ? 'Make ready finished.'
                  : 'Make ready finished, but some checks still fail. Open RigReady for details.',
              }
            : { title: 'Make ready failed', body: result.error.message }
        );
      }),
    launch: () =>
      fromTray(async (profileId, name) => {
        // Never blocked; when the rig is not ready the notification says so.
        const notReady = trayStatus.ready === false;
        const result = await call('fly:launch', { profileId });
        const value = result.ok
          ? (result.value as { outcome: string; message: string })
          : undefined;
        await ports.notifications.notify(
          value?.outcome === 'launched'
            ? {
                title: `${name} launched`,
                body: notReady
                  ? `${value.message}. It was not ready: open RigReady to see what is missing.`
                  : value.message,
              }
            : {
                title: 'Launch did not finish',
                body: value ? value.message : result.ok ? '' : result.error.message,
              }
        );
      }),
    standDown: () =>
      fromTray(async (profileId) => {
        const result = await call('fly:standDown', { profileId });
        await ports.notifications.notify(
          result.ok
            ? { title: 'Stood down', body: (result.value as { headline: string }).headline }
            : { title: 'Stand down failed', body: result.error.message }
        );
      }),
  };

  const switchFromTray = async (profileId: string): Promise<void> => {
    if (trayBusy || profileId === trayStatus.profileId) return;
    // Checking a setup makes it the one in use, on the Fly screen too.
    await call('fly:check', { profileId });
    await call('fly:state');
    flyChanged();
  };

  const trayImages = new Map<string, Electron.NativeImage>();
  function trayImage(tone: 'ok' | 'warn' | 'bad' | undefined): Electron.NativeImage {
    const key = tone ?? 'none';
    const cached = trayImages.get(key);
    if (cached) return cached;
    const base = nativeImage.createFromPath(trayIconPath);
    let image = base;
    if (tone && !base.isEmpty()) {
      const size = 32;
      const bitmap = base.resize({ width: size, height: size }).toBitmap();
      image = nativeImage.createFromBitmap(Buffer.from(paintBadge(bitmap, size, TONE_RGB[tone])), {
        width: size,
        height: size,
      });
    }
    trayImages.set(key, image);
    return image;
  }

  function trayTemplate(items: TrayMenuItem[]): Electron.MenuItemConstructorOptions[] {
    return items.map((item) => {
      if (item.id === 'separator') return { type: 'separator' as const };
      if (item.submenu) {
        return { label: item.label, enabled: item.enabled, submenu: trayTemplate(item.submenu) };
      }
      if (item.id.startsWith('profile:')) {
        return {
          label: item.label,
          type: 'radio' as const,
          checked: item.checked === true,
          enabled: item.enabled,
          click: () => void switchFromTray(item.id.slice('profile:'.length)),
        };
      }
      return {
        label: item.label,
        enabled: item.enabled,
        click: () => void trayActions[item.id]?.(),
      };
    });
  }

  // ---- taskbar button: Jump List, status badge, tooltip, progress, thumbnail buttons ----
  /** What the taskbar was last told, so it is told again only when something changed. */
  const taskbarTold = new TaskbarTold();
  const taskbarFailures = new Set<string>();
  function tellTaskbar(
    what: string,
    key: string,
    tell: () => ReturnType<Ports['taskbar']['setTooltip']>
  ): void {
    if (!taskbarTold.news(what, key)) return;
    void tell().then((told) => {
      if (told.ok || taskbarFailures.has(`${what} ${told.error.code}`)) return;
      // Said once: a PC without a taskbar to tell stays that way for this run.
      taskbarFailures.add(`${what} ${told.error.code}`);
      log.warn(`taskbar: ${what} was not set`, told.error);
    });
  }
  function refreshTaskbar(): void {
    const tasks = jumpTasks(trayStatus);
    tellTaskbar('the Jump List', JSON.stringify(tasks), () => ports.taskbar.setJumpTasks(tasks));
    // The rest belongs to the button of the window: nothing to tell before the window exists.
    if (!mainWindow) return;
    // The badge is drawn only when it is a different one.
    tellTaskbar(
      'the status badge',
      `${trayTone(trayStatus) ?? ''} ${trayStatusLine(trayStatus)}`,
      () => ports.taskbar.setOverlay(taskbarOverlay(trayStatus))
    );
    const tooltip = taskbarTooltip(trayStatus, trayBusy || activity.busy());
    tellTaskbar('the tooltip', tooltip, () => ports.taskbar.setTooltip(tooltip));
    const progress = activity.progress();
    tellTaskbar('the progress bar', JSON.stringify(progress), () =>
      ports.taskbar.setProgress(progress)
    );
    const buttons = thumbButtons(trayStatus, trayBusy || activity.busy());
    tellTaskbar(
      'the thumbnail buttons',
      JSON.stringify(buttons.map((button) => [button.id, button.tooltip, button.enabled])),
      () => ports.taskbar.setButtons(buttons)
    );
  }
  // A button under the thumbnail does what the same line of the tray menu does.
  ports.taskbar.subscribe((buttonId) => void trayActions[buttonId]?.());

  function refreshTray(): void {
    refreshTaskbar();
    if (!tray) return;
    tray.setToolTip(trayTooltip(trayStatus, trayBusy));
    tray.setImage(trayImage(trayTone(trayStatus)));
    tray.setContextMenu(Menu.buildFromTemplate(trayTemplate(trayMenu(trayStatus, trayBusy))));
  }

  if (fake) {
    // Scenario runs only: lets an end-to-end test read and use the tray like a user would.
    const hooks = globalThis as unknown as Record<string, unknown>;
    hooks['__rigreadyTray'] = () => ({
      tooltip: trayTooltip(trayStatus, trayBusy),
      tone: trayTone(trayStatus) ?? null,
      menu: trayMenu(trayStatus, trayBusy),
      notifications: fake.notifications.sent,
      // How often a click put the window away, and whether one is about to.
      hides: trayHides,
      hidePending: trayHideTimer !== undefined,
    });
    // A click or a double-click on the tray icon; `inFront` says the window was the one in
    // front (a test cannot rely on which window Windows has in front).
    hooks['__rigreadyTrayIcon'] = (kind: 'click' | 'double-click', inFront?: boolean) =>
      onTrayIcon(kind, inFront === undefined ? {} : { inFront });
    hooks['__rigreadyClipboard'] = () => fake.clipboard.copied;
    // What a command did, and every program the fake machine was asked to start.
    hooks['__rigreadyCommand'] = () => ({
      run: commands.state(),
      started: fake.processes.started.map((target) => target.exe),
    });
    // Every shortcut the fake machine was asked to make.
    hooks['__rigreadyShortcuts'] = () => fake.shortcuts.built;
    // The taskbar button as the fake machine was last told, and a press on one of its buttons.
    hooks['__rigreadyTaskbar'] = () => ({
      jumpTasks: fake.taskbar.jumpTasks,
      jumpListWrites: fake.taskbar.jumpListWrites,
      overlay: fake.taskbar.overlay ? fake.taskbar.overlay.description : null,
      tone: trayTone(trayStatus) ?? null,
      tooltip: fake.taskbar.tooltip,
      progress: fake.taskbar.progress,
      progressSeen: fake.taskbar.progressSeen,
      buttons: fake.taskbar.buttons.map(({ id, tooltip, enabled }) => ({ id, tooltip, enabled })),
    });
    hooks['__rigreadyTaskbarPress'] = (buttonId: string) => fake.taskbar.press(buttonId);
    // The pictures it was handed, as PNG files a person can look at.
    hooks['__rigreadyTaskbarPictures'] = () => {
      const png = (image: { width: number; height: number; pixels: Uint8Array }): string =>
        nativeImage
          .createFromBitmap(Buffer.from(image.pixels), { width: image.width, height: image.height })
          .toPNG()
          .toString('base64');
      return {
        overlay: fake.taskbar.overlay ? png(fake.taskbar.overlay.icon) : null,
        buttons: Object.fromEntries(fake.taskbar.buttons.map((b) => [b.id, png(b.icon)])),
      };
    };
    hooks['__rigreadyTrayClick'] = async (id: string) => {
      if (id.startsWith('profile:')) await switchFromTray(id.slice('profile:'.length));
      else await trayActions[id]?.();
    };
  }

  for (const channel of handlers.keys()) {
    ipcMain.handle(channel, (_event, rawInput: unknown) => call(channel, rawInput));
  }
  log.info(
    `features: ${wiring.features.map((f) => f.id).join(', ')}; ${wiring.handlers.size} channels`
  );

  // ---- the tray icon itself: a double-click opens RigReady, one click does the sensible thing ----
  /** When the window last stopped being the one in front (a click on the tray takes that away first). */
  let lastInFront = 0;
  let trayHides = 0;
  let trayHideTimer: ReturnType<typeof setTimeout> | undefined;
  /** Longer than the gap between the two clicks of a double-click. */
  const DOUBLE_CLICK_MS = 350;
  const windowState = (): TrayWindowState => ({
    visible: mainWindow?.isVisible() ?? false,
    minimized: mainWindow?.isMinimized() ?? false,
    inFront: (mainWindow?.isFocused() ?? false) || Date.now() - lastInFront < 300,
  });
  function onTrayIcon(kind: 'click' | 'double-click', known: Partial<TrayWindowState> = {}): void {
    clearTimeout(trayHideTimer);
    trayHideTimer = undefined;
    if (trayClick(kind, { ...windowState(), ...known }) === 'show') {
      showWindow();
      return;
    }
    // Putting it away waits a moment: the first click of a double-click must not make it blink.
    trayHideTimer = setTimeout(() => {
      trayHideTimer = undefined;
      trayHides++;
      mainWindow?.hide();
    }, DOUBLE_CLICK_MS);
  }

  try {
    tray = new Tray(nativeImage.createFromPath(trayIconPath));
    tray.on('click', () => onTrayIcon('click'));
    tray.on('double-click', () => onTrayIcon('double-click'));
    refreshTray();
    // Fill in the setup name before the window has asked for it (started hidden at login).
    void call('fly:state');
  } catch (e) {
    log.error('could not create the tray icon', e);
  }

  const stateFile = path.join(dataRoot, 'window.json');
  // A start that was asked to do something is never a hidden one: what it does is shown.
  const startHidden =
    process.argv.includes(HIDDEN_ARG) && tray !== undefined && startCommand.kind === 'none';
  mainWindow = createWindow(
    await readWindowState(ports.files, stateFile),
    ports.files,
    stateFile,
    !startHidden
  );
  watchWindow(mainWindow, log);
  // The taskbar button of the window exists now: its badge, tooltip and buttons can be set.
  realTaskbar?.watch(mainWindow);
  refreshTaskbar();
  mainWindow.on('close', (event) => {
    if (quitting || !tray) return;
    // Decided from the cached settings: the close event cannot wait for a file read.
    void settings.get().then((now) => {
      if (now.ok && !now.value.minimizeToTray) quit();
    });
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on('closed', () => (mainWindow = undefined));
  mainWindow.on('blur', () => (lastInFront = Date.now()));

  // In the tray with the window hidden, memory RigReady is not using goes back to Windows.
  const trimmer = new TrayMemoryTrimmer(() => {
    const trimmed = trimWorkingSets(app.getAppMetrics().map((metric) => metric.pid));
    log.debug(`in the tray: handed unused memory of ${trimmed} processes back to Windows`);
  });
  mainWindow.on('hide', () => trimmer.onHidden());
  mainWindow.on('show', () => trimmer.onShown());
  if (startHidden) trimmer.onHidden();

  runCommand = (parsed) => {
    void commands.handle(parsed).then((run) => {
      if (run)
        log.info(`command ${run.action} "${run.asked}": ${run.outcome ?? run.phase}`, run.reasons);
    });
  };
  runCommand(startCommand.kind === 'none' && handedOver ? handedOver : startCommand);
  handedOver = undefined;

  app.on('window-all-closed', () => app.quit());
  let disposed = false;
  app.on('before-quit', (event) => {
    quitting = true;
    if (disposed) return;
    event.preventDefault();
    disposed = true;
    // Quitting never waits on the machine: a feature still stuck in a driver call that
    // does not answer (a hung USB enumeration) must not keep RigReady from closing.
    const within = (work: Promise<void> | void, ms: number): Promise<void> =>
      Promise.race([
        Promise.resolve(work),
        new Promise<void>((resolve) => setTimeout(resolve, ms)),
      ]);
    void (async () => {
      for (const feature of wiring.features) {
        try {
          await within(feature.dispose?.(), 2000);
        } catch (e) {
          log.error(`dispose ${feature.id}`, e);
        }
      }
      await within(ports.input.stop(), 3000);
      tray?.destroy();
      tray = undefined;
      await logging.flush();
      app.quit();
    })();
  });
}

installProcessErrorHooks();

const refusal = unsupportedPlatformMessage(process.platform);
if (refusal) {
  // RigReady reads and changes Windows itself; anywhere else it says so and stops.
  console.error(refusal);
  dialog.showErrorBox('RigReady', refusal);
  app.exit(1);
} else if (!app.requestSingleInstanceLock({ command: startCommand }) && !argValue('--diagnose')) {
  // RigReady is already running: it was handed what this start asked for, and does it.
  app.quit();
} else {
  app.on('second-instance', (_event, argv, _workingDirectory, handed) =>
    onSecondInstance(argv, handed)
  );
  void app
    .whenReady()
    .then(start)
    .catch((error) => {
      reportStartFailure(error, logging.log);
      void logging.flush().then(() => app.exit(1));
    });
}
