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
import { bind } from '../core/feature';
import { createLogger, type Logger } from '../core/logger';
import { isWithin } from '../core/paths';
import type { FileStore, LogSink, Ports } from '../core/ports';
import { err, ok } from '../core/result';
import {
  ElectronAppWindow,
  ElectronDialogs,
  ElectronLoginItem,
  ElectronNotifications,
  ElectronOverlays,
  ElectronRender,
  ElectronSecrets,
  HIDDEN_ARG,
} from '../platform/electron';
import { ElectronUpdateFeed } from '../platform/electron/updater';
import { applyLiveMutations, startScenario, type FakePorts } from '../platform/fake';
import { pngSize } from '../platform/fake/png';
import { MutationSchema } from '../platform/fake/scenario';
import { RotatingFileSink, systemClock } from '../platform/node';
import { createWindowsPorts } from '../platform/windows';
import { trimWorkingSets } from '../platform/windows/memory';
import { appContract } from '../shared/appContract';
import { eventName } from '../shared/channels';
import type { Envelope } from '../shared/ipc';
import { discoverFeatures, wireFeatures } from './bootstrap';
import { runDiagnose } from './diagnose';
import { unsupportedPlatformMessage } from './platformGuard';
import { TrayMemoryTrimmer } from './trayMemory';
import {
  paintBadge,
  statusFromFlyResponse,
  TONE_RGB,
  trayMenu,
  trayTone,
  trayTooltip,
  type TrayMenuItem,
  type TrayStatus,
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
// The platform is built before the log file exists; what it logs reaches the file once there is one.
let appSink: LogSink | undefined;

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
    const bootLog = createLogger({ write: (line) => appSink?.write(line) }, systemClock);
    return {
      ports: createWindowsPorts({
        log: bootLog,
        projectRoot,
        ...(resourcesPath ? { resourcesPath } : {}),
        app: (dataRoot) => ({
          secrets: new ElectronSecrets(dataRoot),
          dialogs: new ElectronDialogs(() => mainWindow),
          render: new ElectronRender(dataRoot),
          notifications: new ElectronNotifications(),
          loginItem: new ElectronLoginItem(),
          overlays: new ElectronOverlays(),
          window: new ElectronAppWindow(() => mainWindow),
          updates: new ElectronUpdateFeed(bootLog.child('updater')),
        }),
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
  if (show) window.once('ready-to-show', () => window.show());
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

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void window.loadURL(devUrl);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  return window;
}

function showWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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

  app.setAppUserModelId('io.rigready.app');
  const { ports, scenario, fake } = await createPlatform();
  const dataRoot = ports.folders.dataRoot();
  const sink = new RotatingFileSink(path.join(dataRoot, 'logs', 'rigready.log'));
  const log: Logger = createLogger(
    sink,
    ports.clock,
    process.env['RIGREADY_LOG_LEVEL'] === 'debug' ? 'debug' : 'info'
  );
  appSink = sink;
  log.info(`RigReady ${app.getVersion()} starting`, { scenario: scenario ?? null, dataRoot });

  const send = (channel: string, payload: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };
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
  if (settingsNotice) notices.push(settingsNotice);
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
  const handlers = new Map([...wiring.handlers, ...appWiring.handlers]);
  const call = async (channel: string, input?: unknown): Promise<Envelope> => {
    const handler = handlers.get(channel);
    if (!handler) return err('ipc.unknown', `Unknown channel ${channel}.`);
    const envelope = await handler(input);
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

  const fromTray = async (
    work: (profileId: string, name: string) => Promise<void>
  ): Promise<void> => {
    if (trayBusy || !trayStatus.profileId) return;
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
        const result = await call('fly:makeReady', { profileId });
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

  function refreshTray(): void {
    if (!tray) return;
    tray.setToolTip(trayTooltip(trayStatus));
    tray.setImage(trayImage(trayTone(trayStatus)));
    tray.setContextMenu(Menu.buildFromTemplate(trayTemplate(trayMenu(trayStatus, trayBusy))));
  }

  if (fake) {
    // Scenario runs only: lets an end-to-end test read and use the tray like a user would.
    const hooks = globalThis as unknown as Record<string, unknown>;
    hooks['__rigreadyTray'] = () => ({
      tooltip: trayTooltip(trayStatus),
      tone: trayTone(trayStatus) ?? null,
      menu: trayMenu(trayStatus, trayBusy),
      notifications: fake.notifications.sent,
    });
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

  try {
    tray = new Tray(nativeImage.createFromPath(trayIconPath));
    tray.on('click', showWindow);
    refreshTray();
    // Fill in the setup name before the window has asked for it (started hidden at login).
    void call('fly:state');
  } catch (e) {
    log.error('could not create the tray icon', e);
  }

  const stateFile = path.join(dataRoot, 'window.json');
  const startHidden = process.argv.includes(HIDDEN_ARG) && tray !== undefined;
  mainWindow = createWindow(
    await readWindowState(ports.files, stateFile),
    ports.files,
    stateFile,
    !startHidden
  );
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

  // In the tray with the window hidden, memory RigReady is not using goes back to Windows.
  const trimmer = new TrayMemoryTrimmer(() => {
    const trimmed = trimWorkingSets(app.getAppMetrics().map((metric) => metric.pid));
    log.debug(`in the tray: handed unused memory of ${trimmed} processes back to Windows`);
  });
  mainWindow.on('hide', () => trimmer.onHidden());
  mainWindow.on('show', () => trimmer.onShown());
  if (startHidden) trimmer.onHidden();

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
      await sink.close();
      app.quit();
    })();
  });
}

process.on('uncaughtException', (error) => {
  console.error('uncaughtException', error);
});

const refusal = unsupportedPlatformMessage(process.platform);
if (refusal) {
  // RigReady reads and changes Windows itself; anywhere else it says so and stops.
  console.error(refusal);
  dialog.showErrorBox('RigReady', refusal);
  app.exit(1);
} else if (!app.requestSingleInstanceLock() && !argValue('--diagnose')) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  void app
    .whenReady()
    .then(start)
    .catch((error) => {
      console.error('RigReady failed to start', error);
      app.exit(1);
    });
}
