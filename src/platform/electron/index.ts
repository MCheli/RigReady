import { app, BrowserWindow, dialog, Notification, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  Dialogs,
  LoginItem,
  Notifications,
  OpenDialogOptions,
  Render,
  SaveDialogOptions,
  Secrets,
} from '../../core/ports';
import { err, ok, type Result } from '../../core/result';

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

/** The argument RigReady is started with at login, so it knows to stay in the tray. */
export const HIDDEN_ARG = '--hidden';

/**
 * Start with Windows through the per-user Run key (no admin). The entry has a fixed
 * name so updates and reinstalls never create a second one.
 */
export class ElectronLoginItem implements LoginItem {
  private settings(): { path: string; args: string[]; name: string } {
    return { path: process.execPath, args: [HIDDEN_ARG], name: 'RigReady' };
  }

  async isEnabled(): Promise<Result<boolean>> {
    try {
      const state = app.getLoginItemSettings(this.settings());
      return ok(state.openAtLogin && state.executableWillLaunchAtLogin !== false);
    } catch (e) {
      return err('login.read', 'Could not read the Start with Windows setting.', String(e));
    }
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
