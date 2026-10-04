import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nullLogger } from '../../../core/logger';
import { err, ok } from '../../../core/result';
import { FakeUpdateFeed, UPDATE_FEED_FILE } from '../../../platform/fake/updater';
import { headlessPorts } from '../../../platform/node';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { UpdateStatus } from '../contract';
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  UpdateController,
  type UpdateTimer,
} from './controller';
import { gameProcessNames, runningGame } from './games';
import { compareVersions, judgeOffer, parseVersion } from './version';

/** A timer the test fires by hand: what is planned, and for when. */
class ManualTimer implements UpdateTimer {
  planned: { fn: () => void; ms: number } | undefined;
  set(fn: () => void, ms: number): unknown {
    this.planned = { fn, ms };
    return this.planned;
  }
  clear(handle: unknown): void {
    if (handle !== undefined && this.planned === handle) this.planned = undefined;
  }
  /** Runs what is planned and waits for the check it starts. */
  async fire(): Promise<void> {
    const planned = this.planned;
    if (!planned) throw new Error('nothing is planned');
    this.planned = undefined;
    planned.fn();
    await settle();
  }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

interface Harness {
  feed: FakeUpdateFeed;
  timer: ManualTimer;
  controller: UpdateController;
  statuses: UpdateStatus[];
  game: { running: string | undefined; unreadable: boolean };
}

/** The controller on the wired app's real settings store, with a fake feed and a manual timer. */
async function harness(
  settings: { check?: boolean; channel?: 'stable' | 'beta' } = {}
): Promise<Harness> {
  app = await wiredApp('flying-all-good', { files: [] });
  if (Object.keys(settings).length > 0) {
    await app.wiring.context.settings.update({ updates: settings });
  }
  const feed = new FakeUpdateFeed();
  feed.version = '2.0.0';
  const timer = new ManualTimer();
  const statuses: UpdateStatus[] = [];
  const game: Harness['game'] = { running: undefined, unreadable: false };
  const controller = new UpdateController({
    feed,
    settings: app.wiring.context.settings,
    clock: app.clock,
    log: nullLogger,
    timer,
    runningGame: async () =>
      game.unreadable
        ? err('process.list', 'The process list could not be read.')
        : ok(game.running),
    onStatus: (status) => statuses.push(status),
  });
  return { feed, timer, controller, statuses, game };
}

describe('versions', () => {
  it('parses releases and pre-releases and refuses anything else', () => {
    expect(parseVersion('2.1.0')).toEqual({ major: 2, minor: 1, patch: 0, pre: [] });
    expect(parseVersion('v2.1.0-beta.3+build5')).toEqual({
      major: 2,
      minor: 1,
      patch: 0,
      pre: ['beta', 3],
    });
    for (const bad of ['', '2.1', 'latest', '2.1.0-', '2.1.0-beta..1', '1.2.3.4']) {
      expect(parseVersion(bad), bad).toBeUndefined();
    }
  });

  it('orders versions the way semver does', () => {
    const order = [
      '1.1.0',
      '2.0.0-alpha',
      '2.0.0-beta.2',
      '2.0.0-beta.10',
      '2.0.0-beta.10.1',
      '2.0.0-dev.0',
      '2.0.0-rc.1',
      '2.0.0',
      '2.0.1',
      '2.1.0',
      '10.0.0',
    ];
    for (let i = 0; i < order.length; i++) {
      for (let j = 0; j < order.length; j++) {
        const result = Math.sign(
          compareVersions(parseVersion(order[i]!)!, parseVersion(order[j]!)!)
        );
        expect(result, `${order[i]} vs ${order[j]}`).toBe(Math.sign(i - j));
      }
    }
    expect(compareVersions(parseVersion('2.0.0-7')!, parseVersion('2.0.0-beta')!)).toBeLessThan(0);
    expect(compareVersions(parseVersion('2.0.0-beta')!, parseVersion('2.0.0-7')!)).toBeGreaterThan(
      0
    );
  });

  it('the stable channel takes newer releases only; beta also takes -beta versions; nothing is ever a downgrade', () => {
    expect(judgeOffer('2.0.0', '2.1.0', 'stable')).toEqual({ take: true });
    expect(judgeOffer('2.0.0', '2.1.0-beta.1', 'stable')).toEqual({
      take: false,
      why: 'prerelease',
    });
    expect(judgeOffer('2.0.0', '2.1.0-beta.1', 'beta')).toEqual({ take: true });
    expect(judgeOffer('2.0.0', '2.1.0', 'beta')).toEqual({ take: true });
    // Builds that are not for users are never taken, on any channel.
    for (const pre of ['2.1.0-dev.4', '2.1.0-alpha.1', '2.1.0-rc.1']) {
      expect(judgeOffer('2.0.0', pre, 'beta')).toEqual({ take: false, why: 'prerelease' });
    }
    expect(judgeOffer('2.0.0', '2.0.0', 'stable')).toEqual({ take: false, why: 'notNewer' });
    expect(judgeOffer('2.0.0', '1.1.0', 'stable')).toEqual({ take: false, why: 'notNewer' });
    // A beta user is moved on to the release of the same version, never back to an older one.
    expect(judgeOffer('2.1.0-beta.2', '2.1.0', 'stable')).toEqual({ take: true });
    expect(judgeOffer('2.1.0-beta.2', '2.0.0', 'stable')).toEqual({ take: false, why: 'notNewer' });
    // The development build this repository produces is older than its own release.
    expect(judgeOffer('2.0.0-dev.0', '2.0.0', 'stable')).toEqual({ take: true });
    expect(judgeOffer('2.0.0-dev.0', '1.1.0', 'stable')).toEqual({ take: false, why: 'notNewer' });
    expect(judgeOffer('2.0.0', 'newest', 'stable')).toEqual({ take: false, why: 'unreadable' });
  });
});

describe('UpdateController', () => {
  it('checks shortly after the start and then once a day, on the chosen channel', async () => {
    const { feed, timer, controller } = await harness();
    await controller.start();
    expect(controller.status()).toMatchObject({
      phase: 'idle',
      currentVersion: '2.0.0',
      channel: 'stable',
      automatic: true,
    });
    // Nothing is asked before the delay has passed: the Play screen comes first.
    expect(feed.checks).toEqual([]);
    expect(timer.planned?.ms).toBe(FIRST_CHECK_DELAY_MS);

    await timer.fire();
    expect(feed.checks).toEqual(['stable']);
    expect(controller.status().phase).toBe('noRelease');
    expect(timer.planned?.ms).toBe(CHECK_INTERVAL_MS);

    feed.feed = { stable: { version: '2.0.0' } };
    await timer.fire();
    expect(feed.checks).toEqual(['stable', 'stable']);
    expect(controller.status()).toMatchObject({ phase: 'upToDate', installsOnQuit: false });
    expect(controller.status().checkedAt).toBe(app!.clock.now().toISOString());
    expect(timer.planned?.ms).toBe(CHECK_INTERVAL_MS);
    expect(feed.downloads).toBe(0);
  });

  it('downloads a newer version in the background and installs nothing by itself', async () => {
    const { feed, timer, controller, statuses } = await harness();
    feed.feed = { stable: { version: '2.1.0', notes: 'Faster checks' }, hold: true };
    await controller.start();
    await timer.fire();
    expect(controller.status()).toMatchObject({
      phase: 'downloading',
      version: '2.1.0',
      percent: 40,
      installsOnQuit: false,
    });
    feed.feed = { stable: { version: '2.1.0', notes: 'Faster checks' } };
    await new Promise((resolve) => setTimeout(resolve, 120));
    await settle();
    expect(controller.status()).toMatchObject({
      phase: 'ready',
      version: '2.1.0',
      notes: 'Faster checks',
      installsOnQuit: true,
    });
    expect(statuses.map((s) => s.phase)).toEqual([
      'checking',
      'downloading',
      'downloading',
      'downloading',
      'ready',
    ]);
    // Downloaded is all: nothing was installed, and nothing is armed for the quit yet.
    expect(feed.installs).toBe(0);
    expect(feed.installOnQuit).toBe(false);
    // The daily check leaves a downloaded version alone.
    await timer.fire();
    expect(feed.checks).toEqual(['stable']);
    expect(controller.status().phase).toBe('ready');
  });

  it('the stable channel ignores a beta; the beta channel takes it; switching channels drops what was downloaded', async () => {
    const { feed, timer, controller } = await harness();
    feed.feed = { stable: { version: '2.0.0' }, beta: { version: '2.1.0-beta.1' } };
    await controller.start();
    await timer.fire();
    expect(controller.status().phase).toBe('upToDate');

    // A feed that hands a pre-release to the stable channel is not believed.
    feed.feed = { stable: { version: '2.1.0-beta.1' }, beta: { version: '2.1.0-beta.1' } };
    await controller.check();
    expect(controller.status().phase).toBe('upToDate');
    expect(feed.downloads).toBe(0);

    const changed = await controller.setPreferences({ channel: 'beta' });
    expect(changed.ok && changed.value.channel).toBe('beta');
    // The new channel is checked at once.
    expect(timer.planned?.ms).toBe(0);
    await timer.fire();
    expect(feed.checks.at(-1)).toBe('beta');
    expect(controller.status()).toMatchObject({ phase: 'ready', version: '2.1.0-beta.1' });
    expect((await app!.wiring.context.settings.get()).ok).toBe(true);

    // Back to stable: the downloaded beta is not what this PC should get any more.
    await controller.setPreferences({ channel: 'stable' });
    expect(controller.status()).toMatchObject({ phase: 'idle', installsOnQuit: false });
    expect(controller.status().version).toBeUndefined();
    expect(await controller.beforeQuit()).toBe(false);
    expect(feed.installOnQuit).toBe(false);
    expect(feed.installs).toBe(0);
  });

  it('a check that was running for the old channel is dropped when the channel changes', async () => {
    const { feed, timer, controller } = await harness();
    feed.feed = { stable: { version: '2.1.0' }, beta: { version: '2.2.0-beta.1' }, hold: true };
    await controller.start();
    await timer.fire();
    expect(controller.status()).toMatchObject({ phase: 'downloading', version: '2.1.0' });
    await controller.setPreferences({ channel: 'beta' });
    feed.feed = { stable: { version: '2.1.0' }, beta: { version: '2.2.0-beta.1' } };
    await timer.fire();
    await new Promise((resolve) => setTimeout(resolve, 120));
    await settle();
    expect(controller.status()).toMatchObject({ phase: 'ready', version: '2.2.0-beta.1' });
  });

  it('installs on the user’s confirmation, and only then', async () => {
    const { feed, controller } = await harness();
    const early = await controller.install();
    expect(!early.ok && early.error.code).toBe('update.notReady');
    feed.feed = { stable: { version: '2.1.0' } };
    await controller.start();
    await controller.check();
    expect(controller.status().phase).toBe('ready');
    expect(feed.installs).toBe(0);

    const installed = await controller.install();
    expect(installed.ok && installed.value.phase).toBe('installing');
    expect(feed.installs).toBe(1);
    // Already on its way out: the quit does not start a second install.
    expect(await controller.beforeQuit()).toBe(false);
  });

  it('never installs while a game is running: not on confirmation and not on quit', async () => {
    const { feed, controller, game } = await harness();
    feed.feed = { stable: { version: '2.1.0' } };
    await controller.start();
    await controller.check();

    game.running = 'DCS.exe';
    const refused = await controller.install();
    expect(!refused.ok && refused.error.code).toBe('update.gameRunning');
    expect(!refused.ok && refused.error.message).toContain('DCS.exe is running');
    expect(controller.status()).toMatchObject({ phase: 'ready', blockedBy: 'DCS.exe' });
    expect(await controller.beforeQuit()).toBe(false);
    expect(feed.installOnQuit).toBe(false);
    expect(feed.installs).toBe(0);

    // Not knowing is treated like a running game.
    game.running = undefined;
    game.unreadable = true;
    const unknown = await controller.install();
    expect(!unknown.ok && unknown.error.code).toBe('update.gameUnknown');
    expect(await controller.beforeQuit()).toBe(false);
    expect(feed.installs).toBe(0);

    // The game is closed: the update goes in on the next quit.
    game.unreadable = false;
    expect(await controller.beforeQuit()).toBe(true);
    expect(feed.installOnQuit).toBe(true);
    expect(feed.installs).toBe(0);
  });

  it('with automatic checks off nothing is checked or installed on quit, but a check by hand still works', async () => {
    const { feed, timer, controller } = await harness({ check: false });
    feed.feed = { stable: { version: '2.1.0' } };
    await controller.start();
    expect(controller.status()).toMatchObject({ phase: 'idle', automatic: false });
    expect(timer.planned).toBeUndefined();
    expect(feed.checks).toEqual([]);

    await controller.check();
    expect(controller.status()).toMatchObject({
      phase: 'ready',
      version: '2.1.0',
      installsOnQuit: false,
    });
    expect(timer.planned).toBeUndefined();
    expect(await controller.beforeQuit()).toBe(false);
    expect(feed.installOnQuit).toBe(false);
    // The user can still install it by hand.
    const installed = await controller.install();
    expect(installed.ok).toBe(true);
    expect(feed.installs).toBe(1);
  });

  it('turning automatic checks off cancels the daily check; turning them on plans one again', async () => {
    const { feed, timer, controller } = await harness();
    feed.feed = { stable: { version: '2.1.0' } };
    await controller.start();
    await timer.fire();
    expect(controller.status()).toMatchObject({ phase: 'ready', installsOnQuit: true });

    await controller.setPreferences({ automatic: false });
    expect(timer.planned).toBeUndefined();
    expect(controller.status()).toMatchObject({
      phase: 'ready',
      version: '2.1.0',
      automatic: false,
      installsOnQuit: false,
    });
    expect(await controller.beforeQuit()).toBe(false);

    await controller.setPreferences({ automatic: true });
    expect(timer.planned?.ms).toBe(FIRST_CHECK_DELAY_MS);
    expect(controller.status()).toMatchObject({ phase: 'ready', installsOnQuit: true });
    const stored = await app!.wiring.context.settings.get();
    expect(stored.ok && stored.value.updates).toEqual({ check: true, channel: 'stable' });
    controller.stop();
    expect(timer.planned).toBeUndefined();
  });

  it('a failed check or download is a status, never a throw, and the next check can succeed', async () => {
    const { feed, timer, controller } = await harness();
    feed.feed = { checkError: 'getaddrinfo ENOTFOUND github.com' };
    await controller.start();
    await timer.fire();
    expect(controller.status()).toMatchObject({
      phase: 'error',
      message: 'Could not check for updates.',
    });
    expect(timer.planned?.ms).toBe(CHECK_INTERVAL_MS);

    feed.feed = { stable: { version: '2.1.0' }, downloadError: 'sha512 checksum mismatch' };
    await controller.check();
    expect(controller.status()).toMatchObject({
      phase: 'error',
      message: 'The update could not be downloaded.',
    });
    expect(await controller.beforeQuit()).toBe(false);

    feed.feed = { stable: { version: '2.1.0' } };
    await controller.check();
    expect(controller.status().phase).toBe('ready');
  });

  it('two checks asked for at the same time are one check', async () => {
    const { feed, controller } = await harness();
    feed.feed = { stable: { version: '2.0.0' } };
    await controller.start();
    await Promise.all([controller.check(), controller.check()]);
    expect(feed.checks).toEqual(['stable']);
  });

  it('a run that cannot update says why and never asks the feed', async () => {
    const { feed, timer, controller } = await harness();
    feed.reason = 'Updates work in the installed app only, not in a development run.';
    await controller.start();
    expect(controller.status()).toMatchObject({ phase: 'unsupported', message: feed.reason });
    expect(timer.planned).toBeUndefined();
    const checked = await controller.check();
    expect(!checked.ok && checked.error.code).toBe('update.unsupported');
    // The choices are still stored for the installed app.
    await controller.setPreferences({ channel: 'beta', automatic: false });
    expect(controller.status()).toMatchObject({
      phase: 'unsupported',
      channel: 'beta',
      automatic: false,
    });
    expect(feed.checks).toEqual([]);
  });

  it('a failing install leaves the update ready', async () => {
    const { feed, controller } = await harness();
    feed.feed = { stable: { version: '2.1.0' } };
    await controller.start();
    await controller.check();
    feed.quitAndInstall = async () => err('update.install', 'The update could not be installed.');
    const result = await controller.install();
    expect(!result.ok && result.error.code).toBe('update.install');
    expect(controller.status().phase).toBe('ready');
  });
});

describe('the fake update feed', () => {
  it('is steered by a file in the fake user folder, read again at every check', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const feed = app.ports.updates;
    const file = path.join(app.home, UPDATE_FEED_FILE);
    expect(await feed.check('stable')).toEqual({ ok: true, value: null });
    const nothing = await feed.download(() => {});
    expect(!nothing.ok && nothing.error.code).toBe('update.download');

    await fs.writeFile(file, JSON.stringify({ stable: { version: '2.1.0' } }));
    expect(await feed.check('stable')).toEqual({ ok: true, value: { version: '2.1.0' } });
    expect(await feed.check('beta')).toEqual({ ok: true, value: null });
    // A file caught half-written keeps the last good state.
    await fs.writeFile(file, '{ "stable": ');
    expect(await feed.check('stable')).toEqual({ ok: true, value: { version: '2.1.0' } });
    const seen: number[] = [];
    expect((await feed.download((p) => seen.push(p))).ok).toBe(true);
    expect(seen).toEqual([40, 100]);
    expect(feed.downloads).toBe(1);
  });

  it('outside the app there is no updater, and it says so', async () => {
    const feed = headlessPorts.updates;
    expect(feed.unavailable()).toContain('only available inside the RigReady app');
    expect(feed.currentVersion()).toBe('0.0.0');
    feed.setInstallOnQuit(true);
    for (const result of [
      await feed.check('stable'),
      await feed.download(() => {}),
      await feed.quitAndInstall(),
    ]) {
      expect(!result.ok && result.error.code).toBe('port.unavailable');
    }
  });
});

describe('which game is running', () => {
  it('knows every game module’s programs and what each setup launches, and never counts Steam', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const names = await gameProcessNames(app.wiring.context);
    expect(names).toContain('DCS.exe');
    expect(names.map((n) => n.toLowerCase())).not.toContain('steam.exe');
    expect(names.length).toBeGreaterThan(3);
  });

  it('reports the running game, none, or that it cannot tell', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const ctx = app.wiring.context;
    expect(await runningGame(ctx)).toEqual({ ok: true, value: undefined });
    await mutate(app, [
      { op: 'startProcess', name: 'dcs.exe', path: 'C:\\Games\\DCS\\bin\\DCS.exe' },
    ]);
    expect(await runningGame(ctx)).toEqual({ ok: true, value: 'DCS.exe' });
    app.ports.processes.list = async () => err('process.list', 'Access is denied.');
    const unknown = await runningGame(ctx);
    expect(!unknown.ok && unknown.error.code).toBe('process.list');
  });

  it('through IPC: the updates feature answers with the status, refuses an install with nothing downloaded, and decides on quit', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    app.ports.updates.feed = { stable: { version: '9.0.0' } };
    const first = await app.invoke<UpdateStatus>('updates:status');
    expect(first).toMatchObject({ phase: 'idle', channel: 'stable', automatic: true });
    await expect(app.invoke('updates:install')).rejects.toThrow('update.notReady');

    const checked = await app.invoke<UpdateStatus>('updates:check');
    expect(checked).toMatchObject({ phase: 'ready', version: '9.0.0', installsOnQuit: true });
    expect(app.events.some((e) => e.channel === 'updates:event:status')).toBe(true);

    await mutate(app, [
      { op: 'startProcess', name: 'DCS.exe', path: 'C:\\Games\\DCS\\bin\\DCS.exe' },
    ]);
    await expect(app.invoke('updates:install')).rejects.toThrow('update.gameRunning');
    expect(app.ports.updates.installs).toBe(0);
    const updates = app.wiring.features.find((f) => f.id === 'updates')!;
    await updates.dispose?.();
    expect(app.ports.updates.installOnQuit).toBe(false);
  });

  it('through IPC: the channel and the automatic switch are stored in the settings', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const changed = await app.invoke<UpdateStatus>('updates:setPreferences', {
      channel: 'beta',
      automatic: false,
    });
    expect(changed).toMatchObject({ channel: 'beta', automatic: false });
    const stored = await app.wiring.context.settings.get();
    expect(stored.ok && stored.value.updates).toEqual({ check: false, channel: 'beta' });
    await expect(app.invoke('updates:setPreferences', { channel: 'nightly' })).rejects.toThrow();
  });
});
