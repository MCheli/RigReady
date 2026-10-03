import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bind } from '../core/feature';
import { createLogger } from '../core/logger';
import type { Ports } from '../core/ports';
import { ok } from '../core/result';
import { createFakePorts, loadScenario, seedScenario } from '../platform/fake';
import { RotatingFileSink, systemClock } from '../platform/node';
import { createWindowsPorts } from '../platform/windows';
import { appContract } from '../shared/appContract';
import { discoverFeatures, wireFeatures } from './bootstrap';
import { runDiagnose } from './diagnose';

/**
 * Electron bootstrap. Thin: pick the platform (real machine or scenario), wire the
 * features, open the window.
 */

const projectRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
const resourcesPath = app.isPackaged ? process.resourcesPath : undefined;
let mainWindow: BrowserWindow | undefined;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function createPlatform(): Promise<{ ports: Ports; scenario?: string }> {
  const scenarioFile = process.env['RIGREADY_SCENARIO'];
  if (!scenarioFile) {
    const bootLog = createLogger({ write: () => {} }, systemClock);
    const options = { log: bootLog, projectRoot, ...(resourcesPath ? { resourcesPath } : {}) };
    return { ports: createWindowsPorts(options) };
  }
  // Scenario runs never use the real profile: without RIGREADY_HOME they get a temp folder.
  const file = path.resolve(scenarioFile);
  const fixturesDir = path.resolve(path.dirname(file), '..');
  const loaded = await loadScenario(file, fixturesDir);
  const home = process.env['RIGREADY_HOME']
    ? path.resolve(process.env['RIGREADY_HOME'], '..', 'scenario-home')
    : await fs.mkdtemp(path.join(os.tmpdir(), 'rigready-scenario-'));
  const dataRoot = process.env['RIGREADY_HOME']
    ? path.resolve(process.env['RIGREADY_HOME'])
    : path.join(home, '.rigready');
  const ports = createFakePorts({ state: loaded.state, homeDir: home, dataRoot });
  await seedScenario(loaded, ports);
  return { ports, scenario: loaded.scenario.description };
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
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
  window.once('ready-to-show', () => window.show());
  // Links never open inside the app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void window.loadURL(devUrl);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  return window;
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

  const { ports, scenario } = await createPlatform();
  const sink = new RotatingFileSink(path.join(ports.folders.dataRoot(), 'logs', 'rigready.log'));
  const log = createLogger(
    sink,
    ports.clock,
    process.env['RIGREADY_LOG_LEVEL'] === 'debug' ? 'debug' : 'info'
  );
  log.info(`RigReady ${app.getVersion()} starting`, {
    scenario: scenario ?? null,
    dataRoot: ports.folders.dataRoot(),
  });

  const wiring = wireFeatures({
    features: discoverFeatures(),
    ports,
    log,
    send: (channel, payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    },
  });

  const appBinding = bind(appContract, {
    info: async () =>
      ok({
        version: app.getVersion(),
        dataRoot: ports.folders.dataRoot(),
        features: wiring.features.map((f) => f.id),
        ...(scenario ? { scenario } : {}),
      }),
  });
  const appWiring = wireFeatures({
    features: [{ id: 'app', setup: () => [appBinding] }],
    ports,
    log,
    send: () => {},
  });
  for (const [channel, handler] of [...wiring.handlers, ...appWiring.handlers]) {
    ipcMain.handle(channel, (_event, rawInput: unknown) => handler(rawInput));
  }
  log.info(
    `features: ${wiring.features.map((f) => f.id).join(', ')}; ${wiring.handlers.size} channels`
  );

  mainWindow = createWindow();
  mainWindow.on('closed', () => (mainWindow = undefined));

  app.on('window-all-closed', () => app.quit());
  let disposed = false;
  app.on('before-quit', (event) => {
    if (disposed) return;
    event.preventDefault();
    disposed = true;
    void (async () => {
      for (const feature of wiring.features) {
        try {
          await feature.dispose?.();
        } catch (e) {
          log.error(`dispose ${feature.id}`, e);
        }
      }
      await ports.input.stop();
      await sink.close();
      app.quit();
    })();
  });
}

process.on('uncaughtException', (error) => {
  console.error('uncaughtException', error);
});

if (!app.requestSingleInstanceLock() && !argValue('--diagnose')) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  void app
    .whenReady()
    .then(start)
    .catch((error) => {
      console.error('RigReady failed to start', error);
      app.exit(1);
    });
}
