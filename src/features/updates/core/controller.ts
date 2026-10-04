import type { Logger } from '../../../core/logger';
import type { Clock, UpdateChannel, UpdateFeed } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import type { AppSettings, AppSettingsPatch } from '../../../core/settings';
import type { UpdatePhase, UpdateStatus } from '../contract';
import { judgeOffer } from './version';

/** How long after the start the first check runs: the Play screen comes first. */
export const FIRST_CHECK_DELAY_MS = 5_000;
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateTimer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** setTimeout that never keeps the process alive. */
export const systemTimer: UpdateTimer = {
  set: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    handle.unref?.();
    return handle;
  },
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface UpdateSettings {
  get(): Promise<Result<AppSettings>>;
  update(patch: AppSettingsPatch): Promise<Result<AppSettings>>;
  onChange(listener: (settings: AppSettings) => void): () => void;
}

export interface UpdateControllerOptions {
  feed: UpdateFeed;
  settings: UpdateSettings;
  clock: Clock;
  log: Logger;
  timer?: UpdateTimer;
  /** The game that is running now (undefined: none), or an error when that cannot be told. */
  runningGame: () => Promise<Result<string | undefined>>;
  /** Called with every new status, for the renderer. */
  onStatus?: (status: UpdateStatus) => void;
}

type Reason = 'start' | 'daily' | 'manual' | 'channel';

/**
 * Decides everything about updating RigReady: when to check, what to do with what the
 * feed offers, and when a downloaded version may be installed. The rules:
 *
 * - Automatic checks (when on): shortly after the start, then once a day.
 * - A newer version that fits the channel is downloaded in the background. Nothing else
 *   happens by itself during the session.
 * - It is installed only when the user confirms ("Restart to install") or when RigReady
 *   quits, and in both cases only when no game is running.
 * - With automatic checks off nothing is checked, downloaded or installed on quit; the
 *   user can still check by hand and then install by hand.
 */
export class UpdateController {
  private phase: UpdatePhase = 'idle';
  private channel: UpdateChannel = 'stable';
  private automatic = true;
  private version: string | undefined;
  private notes: string | undefined;
  private percent: number | undefined;
  private checkedAt: string | undefined;
  private message: string | undefined;
  private blockedBy: string | undefined;
  private installsOnQuit = false;
  private timerHandle: unknown;
  private unsubscribe: (() => void) | undefined;
  private working: Promise<void> | undefined;
  /** Bumped when the channel changes: a check or download for the old channel is dropped. */
  private generation = 0;

  constructor(private readonly options: UpdateControllerOptions) {}

  private get timer(): UpdateTimer {
    return this.options.timer ?? systemTimer;
  }

  status(): UpdateStatus {
    return {
      phase: this.phase,
      currentVersion: this.options.feed.currentVersion(),
      channel: this.channel,
      automatic: this.automatic,
      installsOnQuit: this.installsOnQuit,
      ...(this.version !== undefined ? { version: this.version } : {}),
      ...(this.notes !== undefined ? { notes: this.notes } : {}),
      ...(this.percent !== undefined ? { percent: this.percent } : {}),
      ...(this.checkedAt !== undefined ? { checkedAt: this.checkedAt } : {}),
      ...(this.message !== undefined ? { message: this.message } : {}),
      ...(this.blockedBy !== undefined ? { blockedBy: this.blockedBy } : {}),
    };
  }

  private set(phase: UpdatePhase, more: { message?: string; percent?: number } = {}): void {
    this.phase = phase;
    this.message = more.message;
    this.percent = more.percent;
    if (phase !== 'ready') this.blockedBy = undefined;
    if (phase !== 'ready' && phase !== 'downloading' && phase !== 'installing') {
      this.version = undefined;
      this.notes = undefined;
    }
    this.installsOnQuit = phase === 'ready' && this.automatic;
    this.options.onStatus?.(this.status());
  }

  /** Reads the settings, follows their changes, and plans the first automatic check. */
  async start(): Promise<void> {
    const settings = await this.options.settings.get();
    if (settings.ok) {
      this.channel = settings.value.updates.channel;
      this.automatic = settings.value.updates.check;
    }
    this.unsubscribe = this.options.settings.onChange((next) => this.settingsChanged(next));
    const reason = this.options.feed.unavailable();
    if (reason) {
      this.set('unsupported', { message: reason });
      return;
    }
    this.plan(FIRST_CHECK_DELAY_MS, 'start');
  }

  stop(): void {
    this.timer.clear(this.timerHandle);
    this.timerHandle = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private plan(ms: number, reason: Reason): void {
    this.timer.clear(this.timerHandle);
    this.timerHandle = undefined;
    if (!this.automatic || this.phase === 'unsupported') return;
    this.timerHandle = this.timer.set(() => {
      void this.run(reason).then(() => this.plan(CHECK_INTERVAL_MS, 'daily'));
    }, ms);
  }

  private settingsChanged(next: AppSettings): void {
    const channelChanged = next.updates.channel !== this.channel;
    const automaticChanged = next.updates.check !== this.automatic;
    if (!channelChanged && !automaticChanged) return;
    this.channel = next.updates.channel;
    this.automatic = next.updates.check;
    if (this.phase === 'unsupported') {
      this.options.onStatus?.(this.status());
      return;
    }
    if (channelChanged) {
      // What was found or downloaded belongs to the other channel: it is never installed.
      // A check still running for the old channel is dropped when it answers.
      this.generation++;
      this.working = undefined;
      this.options.feed.setInstallOnQuit(false);
      this.set('idle');
      // Checks the new channel at once; with automatic checks off this only clears the timer.
      this.plan(0, 'channel');
      return;
    }
    // Only the automatic switch changed: the phase stays, the plan follows the switch.
    this.set(this.phase, {
      ...(this.message !== undefined ? { message: this.message } : {}),
      ...(this.percent !== undefined ? { percent: this.percent } : {}),
    });
    this.plan(FIRST_CHECK_DELAY_MS, 'start');
  }

  /** "Check now". Works with automatic checks off too. */
  async check(): Promise<Result<UpdateStatus>> {
    const reason = this.options.feed.unavailable();
    if (reason) return err('update.unsupported', reason);
    await this.run('manual');
    return ok(this.status());
  }

  /** One check, and the download when it finds something. Calls made meanwhile share it. */
  private run(reason: Reason): Promise<void> {
    if (this.working) return this.working;
    if (this.phase === 'unsupported' || this.phase === 'installing') return Promise.resolve();
    // A version that is already downloaded stays as it is until it is installed.
    if (this.phase === 'ready') return Promise.resolve();
    if (reason !== 'manual' && !this.automatic) return Promise.resolve();
    const work: Promise<void> = this.checkAndDownload(reason).finally(() => {
      if (this.working === work) this.working = undefined;
    });
    this.working = work;
    return work;
  }

  private async checkAndDownload(reason: Reason): Promise<void> {
    const { feed, log, clock } = this.options;
    const generation = this.generation;
    const channel = this.channel;
    const stale = (): boolean => generation !== this.generation;
    this.set('checking');
    const found = await feed.check(channel);
    if (stale()) return;
    this.checkedAt = clock.now().toISOString();
    if (!found.ok) {
      log.warn(`update check (${reason}) failed`, found.error);
      this.set('error', { message: found.error.message });
      return;
    }
    if (found.value === null) {
      log.info(`update check (${reason}): nothing is published on the ${channel} channel`);
      this.set('noRelease');
      return;
    }
    const offer = found.value;
    const verdict = judgeOffer(feed.currentVersion(), offer.version, channel);
    if (!verdict.take) {
      log.info(`update check (${reason}): ${offer.version} is not taken (${verdict.why})`);
      this.set('upToDate');
      return;
    }
    log.info(`update check (${reason}): downloading ${offer.version} from the ${channel} channel`);
    this.version = offer.version;
    this.notes = offer.notes;
    this.set('downloading', { percent: 0 });
    const downloaded = await feed.download((percent) => {
      if (stale() || this.phase !== 'downloading') return;
      this.percent = Math.max(0, Math.min(100, Math.round(percent)));
      this.options.onStatus?.(this.status());
    });
    if (stale()) return;
    if (!downloaded.ok) {
      log.warn('update download failed', downloaded.error);
      this.set('error', { message: downloaded.error.message });
      return;
    }
    log.info(`update ${offer.version} is downloaded; it waits for a restart or the next quit`);
    this.set('ready');
  }

  /**
   * "Restart to install": the only way an update is installed while RigReady is running,
   * and only ever from this call. Refused while a game is running.
   */
  async install(): Promise<Result<UpdateStatus>> {
    if (this.phase !== 'ready') {
      return err('update.notReady', 'There is no downloaded update to install.');
    }
    const game = await this.options.runningGame();
    if (!game.ok) {
      return err(
        'update.gameUnknown',
        'Could not tell whether a game is running, so nothing was installed.',
        game.error.message
      );
    }
    if (game.value !== undefined) {
      this.blockedBy = game.value;
      this.options.onStatus?.(this.status());
      return err(
        'update.gameRunning',
        `${game.value} is running. The update is not installed while a game is running; it will be installed after you quit the game.`
      );
    }
    const version = this.version;
    this.set('installing');
    this.options.log.info(`installing update ${version ?? ''} on the user's confirmation`);
    const started = await this.options.feed.quitAndInstall();
    if (!started.ok) {
      this.set('ready');
      return started;
    }
    return ok(this.status());
  }

  /**
   * Called while RigReady quits: the downloaded update is installed on the way out, unless
   * automatic updates are off, a game is running, or that cannot be told. Returns
   * whether it will be installed.
   */
  async beforeQuit(): Promise<boolean> {
    this.timer.clear(this.timerHandle);
    this.timerHandle = undefined;
    const { feed, log } = this.options;
    if (this.phase !== 'ready' || !this.automatic) {
      feed.setInstallOnQuit(false);
      return false;
    }
    const game = await this.options.runningGame();
    if (!game.ok || game.value !== undefined) {
      feed.setInstallOnQuit(false);
      log.info(
        `update ${this.version ?? ''} is not installed on this quit: ` +
          (game.ok ? `${game.value} is running` : 'the running programs could not be read')
      );
      return false;
    }
    feed.setInstallOnQuit(true);
    log.info(`update ${this.version ?? ''} is installed on this quit`);
    return true;
  }

  /** Stores the automatic switch and the channel; the change takes effect through the settings. */
  async setPreferences(patch: {
    automatic?: boolean;
    channel?: UpdateChannel;
  }): Promise<Result<UpdateStatus>> {
    const updated = await this.options.settings.update({
      updates: {
        ...(patch.automatic !== undefined ? { check: patch.automatic } : {}),
        ...(patch.channel !== undefined ? { channel: patch.channel } : {}),
      },
    });
    if (!updated.ok) return updated;
    return ok(this.status());
  }
}
