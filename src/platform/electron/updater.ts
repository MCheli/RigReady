import { app } from 'electron';
import electronUpdater, { type AppUpdater } from 'electron-updater';
import type { Logger } from '../../core/logger';
import type { UpdateChannel, UpdateFeed, UpdateOffer } from '../../core/ports';
import { err, ok, type Result } from '../../core/result';

/** The variable that points the updater at a feed on this PC instead of GitHub (tests only). */
export const UPDATE_FEED_ENV = 'RIGREADY_UPDATE_FEED';

/**
 * Only a feed on this PC may replace GitHub: an environment variable must never be able
 * to make the installed app download a program from somewhere else.
 */
export function localFeedUrl(env: NodeJS.ProcessEnv): string | undefined {
  const value = env[UPDATE_FEED_ENV];
  if (!value) return undefined;
  return /^http:\/\/127\.0\.0\.1:\d{2,5}(\/[\w./-]*)?$/.test(value) ? value : undefined;
}

/** Errors that mean "there is no release to look at", which is not a failure. */
const NOTHING_PUBLISHED =
  /\b404\b|Unable to find latest version|Cannot find (?:channel|[\w.-]+\.yml)|No published versions/i;
const OFFLINE =
  /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_NETWORK|ERR_TIMED_OUT/i;

const firstLine = (e: unknown): string =>
  (e instanceof Error ? e.message : String(e)).split('\n')[0]!.slice(0, 300);

/**
 * Updates through electron-updater: GitHub Releases as written into the package
 * (resources/app-update.yml, from the `publish` entry of the build configuration).
 * Nothing here decides anything: it checks when asked, downloads when asked, and
 * installs only through quitAndInstall() or, when switched on, as RigReady quits.
 */
export class ElectronUpdateFeed implements UpdateFeed {
  private updater: AppUpdater | undefined;
  private onProgress: ((percent: number) => void) | undefined;
  private installOnQuit = false;
  private quitHooked = false;

  constructor(
    private readonly log: Logger,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  currentVersion(): string {
    return app.getVersion();
  }

  unavailable(): string | undefined {
    if (process.platform !== 'win32') return 'Updates are only available on Windows.';
    if (!app.isPackaged) {
      return 'Updates work in the installed app only, not in a development run.';
    }
    return undefined;
  }

  private get(): AppUpdater {
    if (this.updater) return this.updater;
    const updater = electronUpdater.autoUpdater;
    const log = this.log;
    updater.logger = {
      info: (message?: unknown) => log.debug(String(message)),
      warn: (message?: unknown) => log.warn(String(message)),
      error: (message?: unknown) => log.warn(String(message)),
      debug: (message: string) => log.debug(message),
    };
    // Every step is asked for explicitly by the updates feature.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.autoRunAppAfterInstall = true;
    updater.allowDowngrade = false;
    const local = localFeedUrl(this.env);
    if (local) {
      log.info(`update feed: ${local} (from ${UPDATE_FEED_ENV})`);
      updater.setFeedURL({ provider: 'generic', url: local });
    }
    updater.on('download-progress', (progress) => this.onProgress?.(progress.percent));
    // Failures are reported by the calls that caused them; this keeps a late one from being unhandled.
    updater.on('error', (error) => log.debug(`updater: ${firstLine(error)}`));
    this.updater = updater;
    return updater;
  }

  async check(channel: UpdateChannel): Promise<Result<UpdateOffer | null>> {
    try {
      const updater = this.get();
      // Stable looks at releases only; beta also at versions tagged x.y.z-beta.n.
      updater.allowPrerelease = channel === 'beta';
      updater.channel = channel === 'beta' ? 'beta' : 'latest';
      // Setting the channel switches downgrades on; RigReady never goes back a version.
      updater.allowDowngrade = false;
      const result = await updater.checkForUpdates();
      if (!result) return ok(null);
      const raw = result.updateInfo.releaseNotes;
      // GitHub hands the notes over as HTML; one plain line is enough here.
      const notes =
        typeof raw === 'string'
          ? raw
              .replace(/<[^>]+>/g, ' ')
              .replace(/s+/g, ' ')
              .trim()
              .slice(0, 300)
          : '';
      return ok({ version: result.updateInfo.version, ...(notes ? { notes } : {}) });
    } catch (e) {
      const text = firstLine(e);
      if (OFFLINE.test(text)) {
        return err('update.offline', 'The update server could not be reached.', text);
      }
      if (NOTHING_PUBLISHED.test(text)) {
        this.log.info(`update feed has nothing for the ${channel} channel: ${text}`);
        return ok(null);
      }
      return err('update.check', 'Could not check for updates.', text);
    }
  }

  async download(onProgress: (percent: number) => void): Promise<Result<void>> {
    this.onProgress = onProgress;
    try {
      await this.get().downloadUpdate();
      return ok(undefined);
    } catch (e) {
      return err('update.download', 'The update could not be downloaded.', firstLine(e));
    } finally {
      this.onProgress = undefined;
    }
  }

  setInstallOnQuit(on: boolean): void {
    this.installOnQuit = on;
    if (!on || this.quitHooked) return;
    // electron-updater's own install-on-quit is left off (it only arms itself when it is
    // on at the moment a download ends). This is the same step, armed when RigReady says so.
    this.quitHooked = true;
    const updater = this.get() as AppUpdater & {
      install(isSilent: boolean, isForceRunAfter: boolean): boolean;
    };
    app.once('quit', (_event, exitCode) => {
      if (!this.installOnQuit || exitCode !== 0) return;
      // Synchronous: it starts the installer (silent, per user), which waits for RigReady
      // to be gone. RigReady is not started again afterwards: the user was quitting.
      updater.install(true, false);
    });
  }

  async quitAndInstall(): Promise<Result<void>> {
    try {
      const updater = this.get();
      // Silent, per-user (no elevation), and RigReady starts again afterwards. Deferred
      // so the answer reaches the window before the app begins to quit.
      setImmediate(() => updater.quitAndInstall(true, true));
      return ok(undefined);
    } catch (e) {
      return err('update.install', 'The update could not be installed.', firstLine(e));
    }
  }
}
