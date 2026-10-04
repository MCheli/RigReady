import { app, BrowserWindow, clipboard, dialog, Notification, safeStorage, screen } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AppWindow,
  Clipboard,
  Dialogs,
  LoginItem,
  Notifications,
  OpenDialogOptions,
  Overlays,
  Registry,
  PanelWindow,
  Render,
  SaveDialogOptions,
  ScreenArea,
  ScreenLabel,
  Secrets,
} from '../../core/ports';
import { loginEntryEnabled, RUN_KEY, STARTUP_APPROVED_KEY } from '../../core/loginItem';
import { err, ok, type Result } from '../../core/result';
import { WindowsRegistry } from '../windows/registry';

/** The ports that need Electron: secret storage, file pickers, HTML rendering, notifications, login item. */

const SECRET_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Secrets encrypted with Electron safeStorage (DPAPI: only this Windows user on this PC
 * can decrypt them), one file per secret under <data root>/secrets. Never plain text.
 */
export class ElectronSecrets implements Secrets {
  constructor(private readonly dataRoot: string) {}

  private file(name: string): Result<string> {
    if (!SECRET_NAME.test(name)) return err('secret.name', `Invalid secret name: ${name}`);
    return ok(path.join(this.dataRoot, 'secrets', `${name}.bin`));
  }

  async get(name: string): Promise<Result<string | undefined>> {
    const file = this.file(name);
    if (!file.ok) return file;
    let encrypted: Buffer;
    try {
      encrypted = await fs.readFile(file.value);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return ok(undefined);
      return err('secret.read', 'Could not read the stored secret.', String(e));
    }
    try {
      return ok(safeStorage.decryptString(encrypted));
    } catch (e) {
      return err(
        'secret.decrypt',
        'The stored secret cannot be decrypted on this PC with this Windows account.',
        String(e)
      );
    }
  }

  async set(name: string, value: string): Promise<Result<void>> {
    const file = this.file(name);
    if (!file.ok) return file;
    if (!safeStorage.isEncryptionAvailable()) {
      return err(
        'secret.unavailable',
        'Windows cannot encrypt secrets for this account right now.'
      );
    }
    try {
      await fs.mkdir(path.dirname(file.value), { recursive: true });
      await fs.writeFile(file.value, safeStorage.encryptString(value));
      return ok(undefined);
    } catch (e) {
      return err('secret.write', 'Could not store the secret.', String(e));
    }
  }

  async remove(name: string): Promise<Result<void>> {
    const file = this.file(name);
    if (!file.ok) return file;
    try {
      await fs.rm(file.value, { force: true });
      return ok(undefined);
    } catch (e) {
      return err('secret.write', 'Could not remove the stored secret.', String(e));
    }
  }
}

export class ElectronDialogs implements Dialogs {
  constructor(private readonly parent: () => BrowserWindow | undefined) {}

  async open(options: OpenDialogOptions = {}): Promise<Result<string[]>> {
    const properties: ('openFile' | 'openDirectory' | 'multiSelections')[] = [
      options.directory ? 'openDirectory' : 'openFile',
    ];
    if (options.multiple) properties.push('multiSelections');
    const config = {
      properties,
      ...(options.title ? { title: options.title } : {}),
      ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
      ...(options.filters ? { filters: options.filters } : {}),
    };
    try {
      const parent = this.parent();
      const result = parent
        ? await dialog.showOpenDialog(parent, config)
        : await dialog.showOpenDialog(config);
      return ok(result.canceled ? [] : result.filePaths);
    } catch (e) {
      return err('dialog.open', 'Could not show the file picker.', String(e));
    }
  }

  async save(options: SaveDialogOptions = {}): Promise<Result<string | null>> {
    const config = {
      ...(options.title ? { title: options.title } : {}),
      ...(options.defaultPath ? { defaultPath: options.defaultPath } : {}),
      ...(options.filters ? { filters: options.filters } : {}),
    };
    try {
      const parent = this.parent();
      const result = parent
        ? await dialog.showSaveDialog(parent, config)
        : await dialog.showSaveDialog(config);
      return ok(result.canceled || !result.filePath ? null : result.filePath);
    } catch (e) {
      return err('dialog.save', 'Could not show the file picker.', String(e));
    }
  }
}

/**
 * Renders HTML in a hidden, sandboxed window with JavaScript off. The HTML is loaded
 * from a temp file under the data root (data: URLs are size-limited), which is removed
 * afterwards. Renders run one at a time.
 */
export class ElectronRender implements Render {
  private queue: Promise<unknown> = Promise.resolve();
  private counter = 0;

  constructor(private readonly dataRoot: string) {}

  private run<T>(job: () => Promise<Result<T>>): Promise<Result<T>> {
    const next = this.queue.then(job, job);
    // The queue only orders the jobs; each caller gets its own job's result, or failure, from next.
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async withPage<T>(
    html: string,
    size: { width: number; height: number },
    use: (window: BrowserWindow) => Promise<T>
  ): Promise<T> {
    const dir = path.join(this.dataRoot, 'tmp');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `render-${process.pid}-${++this.counter}.html`);
    await fs.writeFile(file, html, 'utf8');
    const window = new BrowserWindow({
      show: false,
      width: size.width,
      height: size.height,
      useContentSize: true,
      frame: false,
      enableLargerThanScreen: true,
      skipTaskbar: true,
      webPreferences: {
        offscreen: true,
        javascript: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    try {
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      await window.loadFile(file);
      return await use(window);
    } finally {
      window.destroy();
      await fs.rm(file, { force: true });
    }
  }

  png(html: string, size: { width: number; height: number }): Promise<Result<Uint8Array>> {
    if (size.width < 1 || size.height < 1 || size.width > 8192 || size.height > 8192) {
      return Promise.resolve(
        err('render.size', 'The image size must be between 1 and 8192 pixels.')
      );
    }
    return this.run(async () => {
      try {
        const bytes = await this.withPage(html, size, async (window) => {
          window.setContentSize(size.width, size.height);
          let image = await window.webContents.capturePage({
            x: 0,
            y: 0,
            width: size.width,
            height: size.height,
          });
          const actual = image.getSize();
          // On a scaled display the capture is larger than asked for; bring it to the exact size.
          if (actual.width !== size.width || actual.height !== size.height) {
            image = image.resize({ width: size.width, height: size.height, quality: 'best' });
          }
          return image.toPNG();
        });
        return ok(new Uint8Array(bytes));
      } catch (e) {
        return err('render.png', 'Could not render the image.', String(e));
      }
    });
  }

  pdf(
    html: string,
    options: { pageSize?: 'A4' | 'Letter'; landscape?: boolean } = {}
  ): Promise<Result<Uint8Array>> {
    return this.run(async () => {
      try {
        const bytes = await this.withPage(html, { width: 1024, height: 768 }, (window) =>
          window.webContents.printToPDF({
            pageSize: options.pageSize ?? 'A4',
            landscape: options.landscape ?? false,
            printBackground: true,
          })
        );
        return ok(new Uint8Array(bytes));
      } catch (e) {
        return err('render.pdf', 'Could not render the document.', String(e));
      }
    });
  }
}

export class ElectronNotifications implements Notifications {
  async notify(message: { title: string; body: string }): Promise<Result<void>> {
    if (!Notification.isSupported()) {
      return err('notify.unsupported', 'Windows notifications are turned off.');
    }
    try {
      new Notification({ title: message.title, body: message.body }).show();
      return ok(undefined);
    } catch (e) {
      return err('notify.show', 'Could not show the notification.', String(e));
    }
  }
}

export class ElectronClipboard implements Clipboard {
  async writeText(text: string): Promise<Result<void>> {
    try {
      clipboard.writeText(text);
      return ok(undefined);
    } catch (e) {
      return err('clipboard.write', 'Could not copy to the clipboard.', String(e));
    }
  }
}

/** The argument RigReady is started with at login, so it knows to stay in the tray. */
export const HIDDEN_ARG = '--hidden';

/**
 * Start with Windows through the per-user Run key (no admin). The entry has a fixed
 * name so updates and reinstalls never create a second one.
 */
export class ElectronLoginItem implements LoginItem {
  constructor(private readonly registry: Registry = new WindowsRegistry()) {}

  private settings(): { path: string; args: string[]; name: string } {
    return { path: process.execPath, args: [HIDDEN_ARG], name: 'RigReady' };
  }

  async isEnabled(): Promise<Result<boolean>> {
    // Read from the registry entry itself: Electron's getLoginItemSettings does not find
    // the entry when the program's path has a space in it (a user folder like
    // "C:\Users\Jane Doe"), which would make Start with Windows impossible to turn on.
    const { path: exe, name } = this.settings();
    const entry = await this.registry.getValue('HKCU', RUN_KEY, name);
    if (!entry.ok) {
      return err(
        'login.read',
        'Could not read the Start with Windows setting.',
        entry.error.message
      );
    }
    const approved = await this.registry.getValue('HKCU', STARTUP_APPROVED_KEY, name);
    return ok(
      loginEntryEnabled(
        entry.value?.type === 'string' ? entry.value.value : undefined,
        approved.ok && approved.value?.type === 'binary' ? approved.value.value : undefined,
        exe
      )
    );
  }

  async setEnabled(enabled: boolean): Promise<Result<void>> {
    if (!app.isPackaged) {
      // In development process.execPath is electron.exe; registering it would start a bare Electron at login.
      return err(
        'login.dev',
        'Start with Windows can only be changed in the installed app, not in a development run.'
      );
    }
    try {
      app.setLoginItemSettings({ ...this.settings(), openAtLogin: enabled, enabled });
      return ok(undefined);
    } catch (e) {
      return err('login.write', 'Could not change the Start with Windows setting.', String(e));
    }
  }
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Labels as frameless, click-through windows that stay on top, one per monitor. The
 * coordinates are desktop pixels (what DisplayProvider reports); Electron wants its own
 * scaled units, so each label is placed through the matching Electron display.
 */
/** Keeps the app window where the user can see it across a monitor layout change. */
export class ElectronAppWindow implements AppWindow {
  private readonly panelWindows = new Map<string, BrowserWindow>();

  constructor(
    private readonly window: () => BrowserWindow | undefined,
    /** How a panel window gets the app: the preload script and a loader for a route. */
    private readonly host?: { preload: string; load(window: BrowserWindow, route: string): void }
  ) {}

  /** The open panel windows, so events reach them like the main window. */
  panels(): BrowserWindow[] {
    return [...this.panelWindows.values()].filter((w) => !w.isDestroyed());
  }

  async openPanel(panel: PanelWindow): Promise<Result<{ opened: boolean }>> {
    if (!this.host) return err('window.panel', 'Extra windows are not available here.');
    if (!panel.route.startsWith('/')) return err('window.panel', 'A panel needs an in-app route.');
    try {
      let window = this.panelWindows.get(panel.id);
      if (!window || window.isDestroyed()) {
        window = new BrowserWindow({
          width: panel.width,
          height: panel.height,
          minWidth: 320,
          minHeight: 240,
          backgroundColor: '#0f1317',
          autoHideMenuBar: true,
          title: panel.title,
          alwaysOnTop: panel.alwaysOnTop === true,
          webPreferences: {
            preload: this.host.preload,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('will-navigate', (event) => event.preventDefault());
        const id = panel.id;
        window.on('closed', () => this.panelWindows.delete(id));
        // A panel never outlives the app's main window.
        this.window()?.once('closed', () => {
          const open = this.panelWindows.get(id);
          if (open && !open.isDestroyed()) open.destroy();
        });
        this.panelWindows.set(panel.id, window);
      }
      this.host.load(window, panel.route);
      if (window.isMinimized()) window.restore();
      window.show();
      return ok({ opened: true });
    } catch (e) {
      return err('window.panel', 'Could not open the window.', String(e));
    }
  }

  async showOn(areas: ScreenArea[]): Promise<Result<{ moved: boolean }>> {
    const window = this.window();
    if (!window || window.isDestroyed() || areas.length === 0) return ok({ moved: false });
    try {
      // Areas are physical pixels; Electron places windows in its own scaled units.
      const dip = areas.map((area) => screen.screenToDipRect(null, area));
      const bounds = window.getNormalBounds();
      const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      const inside = dip.some(
        (a) =>
          centre.x >= a.x &&
          centre.x < a.x + a.width &&
          centre.y >= a.y &&
          centre.y < a.y + a.height
      );
      if (!inside) {
        const target = dip[0]!;
        if (window.isMaximized()) window.unmaximize();
        const width = Math.min(bounds.width, target.width);
        const height = Math.min(bounds.height, target.height);
        window.setBounds({
          x: Math.round(target.x + (target.width - width) / 2),
          y: Math.round(target.y + (target.height - height) / 2),
          width,
          height,
        });
      }
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      return ok({ moved: !inside });
    } catch (e) {
      return err('window.show', 'Could not move the RigReady window.', String(e));
    }
  }
}

export class ElectronOverlays implements Overlays {
  private windows: BrowserWindow[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;

  private clear(): void {
    clearTimeout(this.timer);
    for (const window of this.windows) if (!window.isDestroyed()) window.destroy();
    this.windows = [];
  }

  async showLabels(labels: ScreenLabel[], durationMs: number): Promise<Result<void>> {
    this.clear();
    try {
      for (const label of labels) {
        // The middle of the monitor, converted from physical pixels to Electron's coordinates.
        const centre = screen.screenToDipPoint({
          x: label.x + Math.round(label.width / 2),
          y: label.y + Math.round(label.height / 2),
        });
        const area = screen.getDisplayNearestPoint(centre).bounds;
        const width = Math.min(360, area.width);
        const height = Math.min(260, area.height);
        const window = new BrowserWindow({
          x: Math.round(area.x + (area.width - width) / 2),
          y: Math.round(area.y + (area.height - height) / 2),
          width,
          height,
          frame: false,
          transparent: true,
          resizable: false,
          movable: false,
          focusable: false,
          skipTaskbar: true,
          alwaysOnTop: true,
          show: false,
          webPreferences: { javascript: false, sandbox: true, contextIsolation: true },
        });
        window.setIgnoreMouseEvents(true);
        window.setAlwaysOnTop(true, 'screen-saver');
        const html =
          '<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;' +
          'justify-content:center;background:rgba(15,19,23,0.92);color:#e6e9ed;border-radius:18px;' +
          'font-family:Segoe UI,sans-serif;overflow:hidden">' +
          (label.up
            ? '<div style="font-size:44px;line-height:1;color:#5aa9e6">&#9650;</div>' +
              '<div style="font-size:13px;letter-spacing:2px;color:#5aa9e6;margin-bottom:2px">THIS SIDE UP</div>'
            : '') +
          `<div style="font-size:${label.up ? 120 : 150}px;font-weight:700;line-height:1">${escapeHtml(label.text)}</div>` +
          (label.caption
            ? `<div style="font-size:20px;margin-top:8px;color:#8b95a3">${escapeHtml(label.caption)}</div>`
            : '') +
          '</body>';
        this.windows.push(window);
        await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        window.showInactive();
      }
      this.timer = setTimeout(() => this.clear(), durationMs);
      return ok(undefined);
    } catch (e) {
      this.clear();
      return err('overlay.show', 'Could not show the labels on the monitors.', String(e));
    }
  }
}
