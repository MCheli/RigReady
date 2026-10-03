import path from 'node:path';
import {
  fixItem,
  makeReady,
  runCheckItem,
  runChecks,
  standDown,
  type ActionReport,
  type CheckResult,
  type ChecklistReport,
  type StepResult,
} from '../../../core/checks/engine';
import type { MainContext } from '../../../core/feature';
import { JsonStore } from '../../../core/jsonStore';
import { allPathVariables, expandPath } from '../../../core/pathVariables';
import { profileActions, type Profile } from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import { steamRoot } from '../../../core/steam';
import {
  PreferencesSchema,
  type FlyState,
  type LaunchResult,
  type LaunchStep,
  type Preferences,
  type ProfileView,
} from '../contract';
import { actionConfirmation, realSleep, runAction, startedProgram, type Sleep } from './actions';

export type Ctx = Pick<MainContext, 'ports' | 'log' | 'checks' | 'profiles' | 'settings' | 'games'>;

export interface FlyEvents {
  result(payload: { runId: string; profileId: string; result: CheckResult }): void;
  progress(payload: {
    runId: string;
    itemId: string;
    title: string;
    state: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
    message?: string;
  }): void;
  launchProgress(payload: {
    runId: string;
    phase: 'preLaunch' | 'launch' | 'postLaunch';
    id: string;
    title: string;
    state: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
    message?: string;
  }): void;
}

export interface FlyOptions {
  /** Waits between polls and for post-launch delays. */
  sleep?: Sleep;
  /** Waits for an action's timeout. */
  timer?: Sleep;
  /** How long Launch waits for the game to show up. */
  launchConfirmMs?: number;
}

const baseName = (exe: string): string => path.win32.basename(exe.replace(/\//g, '\\'));
const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Fly mode on the main side. Holds what lives for the session: the newest check run (so a
 * slower, older run never reports over a newer one), and the programs launch actions started.
 */
export class Fly {
  private latestRun: string | undefined;
  private readonly startedByActions = new Set<string>();
  private readonly prefs: JsonStore<typeof PreferencesSchema>;
  private readonly sleep: Sleep;
  private readonly timer: Sleep;
  private readonly launchConfirmMs: number;

  constructor(
    private readonly ctx: Ctx,
    private readonly events: FlyEvents,
    options: FlyOptions = {}
  ) {
    this.prefs = new JsonStore(
      ctx.ports.files,
      path.join(ctx.ports.folders.dataRoot(), 'fly', 'preferences.json'),
      PreferencesSchema
    );
    this.sleep = options.sleep ?? realSleep;
    this.timer = options.timer ?? realSleep;
    this.launchConfirmMs = options.launchConfirmMs ?? 30_000;
  }

  // ---- profiles ----

  /** A profile that loads, or the last version that loaded when a hand edit broke the file. */
  async profile(id: string): Promise<Result<{ profile: Profile; problem?: string }>> {
    const loaded = await this.ctx.profiles.get(id);
    if (loaded.ok) return ok({ profile: loaded.value });
    const previous = this.ctx.profiles.lastValid(id);
    if (previous && loaded.error.code !== 'profile.missing') {
      const problem = loaded.error.detail
        ? `${loaded.error.message} ${loaded.error.detail}`
        : loaded.error.message;
      return ok({ profile: previous, problem });
    }
    return loaded;
  }

  private async timeoutMs(): Promise<number> {
    const settings = await this.ctx.settings.get();
    return (settings.ok ? settings.value.checkTimeoutSeconds : 5) * 1000;
  }

  private gameName(profile: Profile): string | undefined {
    if (profile.game === 'other') return profile.gameName;
    return profile.game ? (this.ctx.games.get(profile.game)?.name ?? profile.game) : undefined;
  }

  view(profile: Profile, problem?: string): ProfileView {
    const actions = profileActions(profile);
    const launchLabel = profile.steamAppId
      ? `Steam app ${profile.steamAppId}`
      : profile.launch
        ? baseName(profile.launch.exe)
        : undefined;
    return {
      profileId: profile.id,
      name: profile.name,
      items: profile.checks.map((item) => ({
        itemId: item.id,
        type: item.type,
        title: item.title,
        group: this.ctx.checks.check(item.type)?.group ?? 'other',
        required: this.ctx.checks.check(item.type)?.advisory ? false : item.required,
      })),
      ...(launchLabel ? { launchLabel } : {}),
      actions: (['preLaunch', 'postLaunch', 'standDown'] as const).flatMap((phase) =>
        actions[phase].map((action) => {
          const confirm = actionConfirmation(action, this.ctx.checks);
          return { id: action.id, title: action.title, phase, ...(confirm ? { confirm } : {}) };
        })
      ),
      ...(problem ? { problem } : {}),
    };
  }

  async state(): Promise<Result<FlyState>> {
    const listed = await this.ctx.profiles.listDetailed();
    if (!listed.ok) return listed;
    const { profiles, invalid } = listed.value;
    const lastUsed = await this.ctx.profiles.lastUsed();
    const state: FlyState = {
      profiles: profiles.map(({ profile }) => {
        const gameName = this.gameName(profile);
        return {
          id: profile.id,
          name: profile.name,
          ...(profile.game ? { game: profile.game } : {}),
          ...(gameName ? { gameName } : {}),
          ...(lastUsed[profile.id] ? { lastUsed: lastUsed[profile.id] } : {}),
          canLaunch: profile.launch !== undefined || profile.steamAppId !== undefined,
        };
      }),
      invalid: invalid.map((i) => ({
        id: i.id,
        file: i.file,
        message: i.message,
        ...(i.detail ? { detail: i.detail } : {}),
      })),
    };
    const last = await this.ctx.profiles.lastProfileId();
    let active = profiles.find((p) => p.profile.id === last)?.profile;
    let problem: string | undefined;
    if (!active && last) {
      // Broken by a hand edit this session: keep showing the last version that loaded.
      const kept = this.ctx.profiles.lastValid(last);
      const broken = invalid.find((i) => i.id === last);
      if (kept && broken) {
        active = kept;
        problem = broken.detail ? `${broken.message} ${broken.detail}` : broken.message;
        // Listed under its last good name, so the switcher still shows it.
        state.profiles.push({
          id: kept.id,
          name: kept.name,
          ...(kept.game ? { game: kept.game } : {}),
          canLaunch: kept.launch !== undefined || kept.steamAppId !== undefined,
        });
        state.invalid = state.invalid.filter((i) => i.id !== kept.id);
      } else {
        const fallback = [...profiles].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.profile;
        if (fallback) {
          state.notice = broken
            ? `The setup you used last ("${last}") could not be opened: ${broken.message} Showing "${fallback.name}" instead.`
            : `The setup you used last ("${last}") no longer exists. Showing "${fallback.name}" instead.`;
          active = fallback;
        }
      }
    }
    active ??= profiles[0]?.profile;
    if (active) {
      state.activeProfileId = active.id;
      state.active = this.view(active, problem);
    }
    return ok(state);
  }

  async profileView(id: string): Promise<Result<ProfileView>> {
    const found = await this.profile(id);
    if (!found.ok) return found;
    return ok(this.view(found.value.profile, found.value.problem));
  }

  /** Remembers the profile as the one in use. Writes only when it changes. */
  private async remember(id: string): Promise<void> {
    // Read each time: the setups page and the tray change it too.
    if ((await this.ctx.profiles.lastProfileId()) === id) return;
    await this.ctx.profiles.setLastProfileId(id, this.ctx.ports.clock.now());
  }

  // ---- checks ----

  async check(
    profileId: string,
    runId?: string,
    remember = true
  ): Promise<Result<ChecklistReport>> {
    const found = await this.profile(profileId);
    if (!found.ok) return found;
    if (remember) await this.remember(profileId);
    // Results stream as events only to a caller that tagged its run (the Fly screen).
    if (runId) this.latestRun = runId;
    return ok(
      await runChecks(found.value.profile, this.ctx.checks, this.ctx, {
        timeoutMs: await this.timeoutMs(),
        onResult: (result) => {
          // A newer run (another profile, or Re-check all) makes this one stale.
          if (!runId || this.latestRun !== runId) return;
          this.events.result({ runId, profileId, result });
        },
      })
    );
  }

  async checkItem(profileId: string, itemId: string): Promise<Result<CheckResult>> {
    const found = await this.profile(profileId);
    if (!found.ok) return found;
    const item = found.value.profile.checks.find((c) => c.id === itemId);
    if (!item) return err('fly.noItem', `"${found.value.profile.name}" has no item ${itemId}.`);
    return ok(
      await runCheckItem(item, this.ctx.checks, this.ctx, { timeoutMs: await this.timeoutMs() })
    );
  }

  async fix(
    profileId: string,
    itemId: string,
    confirmed: boolean
  ): Promise<Result<{ step: StepResult; result: CheckResult }>> {
    const found = await this.profile(profileId);
    if (!found.ok) return found;
    const fixed = await fixItem(found.value.profile, itemId, this.ctx.checks, this.ctx, {
      timeoutMs: await this.timeoutMs(),
      confirm: async () => confirmed,
    });
    if (!fixed) return err('fly.noItem', `"${found.value.profile.name}" has no item ${itemId}.`);
    this.ctx.log.info(`fix ${profileId}/${itemId}`, fixed.step);
    return ok(fixed);
  }

  async makeReady(
    profileId: string,
    options: { runId?: string; approved?: string[] } = {}
  ): Promise<Result<ActionReport>> {
    const found = await this.profile(profileId);
    if (!found.ok) return found;
    const approved = options.approved ? new Set(options.approved) : undefined;
    const runId = options.runId;
    const report = await makeReady(found.value.profile, this.ctx.checks, this.ctx, {
      timeoutMs: await this.timeoutMs(),
      ...(approved ? { confirm: async (item) => approved.has(item.id) } : {}),
      ...(runId ? { onProgress: (p) => this.events.progress({ runId, ...p }) } : {}),
    });
    this.ctx.log.info(`make ready ${profileId}`, report.steps);
    return ok(report);
  }

  async acknowledge(profileId: string, itemId: string): Promise<Result<CheckResult>> {
    const loaded = await this.ctx.profiles.get(profileId);
    if (!loaded.ok) return loaded;
    const profile = loaded.value;
    const item = profile.checks.find((c) => c.id === itemId);
    const definition = item ? this.ctx.checks.check(item.type) : undefined;
    if (!item || !definition?.acknowledge) {
      return err('fly.noAcknowledge', 'This item has nothing to confirm.');
    }
    const params = definition.params.safeParse(item.params);
    if (!params.success) return err('fly.invalidItem', 'This check is not set up correctly.');
    const next = await definition.acknowledge.run(params.data, this.ctx);
    if (!next.ok) return next;
    const updated: Profile = {
      ...profile,
      updatedAt: this.ctx.ports.clock.now().toISOString(),
      checks: profile.checks.map((c) =>
        c.id === itemId ? { ...c, params: next.value as Record<string, unknown> } : c
      ),
    };
    const saved = await this.ctx.profiles.save(updated);
    if (!saved.ok) return saved;
    return this.checkItem(profileId, itemId);
  }

  // ---- launch ----

  /** The program Launch starts, resolved for this PC. */
  private async launchTarget(
    profile: Profile
  ): Promise<Result<{ exe: string; args: string[]; cwd?: string; waitFor?: string }>> {
    if (profile.steamAppId) {
      const root = await steamRoot(this.ctx.ports.registry);
      if (!root)
        return err(
          'fly.noSteam',
          'Steam is not installed, so the game cannot be started through it.'
        );
      // Steam takes the game from here; the handoff is a program start with one argument.
      return ok({
        exe: path.join(root, 'steam.exe'),
        args: [`steam://rungameid/${profile.steamAppId}`],
      });
    }
    const target = profile.launch;
    if (!target) return err('fly.noLaunch', `"${profile.name}" has no program to launch.`);
    const needsVariables = target.exe.includes('{') || (target.cwd ?? '').includes('{');
    const variables = needsVariables ? await allPathVariables(this.ctx, this.ctx.games) : {};
    const exe = expandPath(target.exe, variables);
    if (!exe.ok) return exe;
    const cwd = target.cwd ? expandPath(target.cwd, variables) : undefined;
    if (cwd && !cwd.ok) return cwd;
    return ok({ exe: exe.value, args: target.args, ...(cwd ? { cwd: cwd.value } : {}) });
  }

  private async isRunning(name: string): Promise<boolean> {
    const list = await this.ctx.ports.processes.list();
    return list.ok && list.value.some((p) => sameName(p.name, name));
  }

  async gameStatus(profileId: string): Promise<Result<{ running: boolean; name?: string }>> {
    const found = await this.profile(profileId);
    if (!found.ok) return found;
    const profile = found.value.profile;
    if (!profile.launch || profile.steamAppId) return ok({ running: false });
    const name = baseName(profile.launch.exe);
    return ok({ running: await this.isRunning(name), name });
  }

  async launch(
    profileId: string,
    options: { runId?: string; resumeAfter?: number; approved?: string[] } = {}
  ): Promise<Result<LaunchResult>> {
    const found = await this.profile(profileId);
    if (!found.ok) return found;
    const profile = found.value.profile;
    const runId = options.runId ?? `launch-${this.ctx.ports.clock.now().getTime()}`;
    const approved = new Set(options.approved ?? []);
    const actions = profileActions(profile);
    const steps: LaunchStep[] = [];
    const report = (
      phase: LaunchStep['phase'],
      id: string,
      title: string,
      state: 'pending' | 'running' | 'done' | 'failed' | 'skipped',
      message?: string
    ): void =>
      this.events.launchProgress({
        runId,
        phase,
        id,
        title,
        state,
        ...(message ? { message } : {}),
      });

    const first = options.resumeAfter === undefined ? 0 : options.resumeAfter + 1;
    const pre = actions.preLaunch.slice(first);
    for (const action of pre) report('preLaunch', action.id, action.title, 'pending');
    for (const [offset, action] of pre.entries()) {
      report('preLaunch', action.id, action.title, 'running');
      const step = await runAction(action, this.ctx.checks, this.ctx, {
        timer: this.timer,
        approved,
      });
      steps.push({ ...step, phase: 'preLaunch' });
      report(
        'preLaunch',
        action.id,
        action.title,
        step.skipped ? 'skipped' : step.ok ? 'done' : 'failed',
        step.message
      );
      if (step.ok) {
        const program = startedProgram(action);
        if (program && action.closeOnStandDown !== false) this.startedByActions.add(program);
      } else if (!action.continueOnError) {
        // Never silently on, never silently off: the user decides.
        return ok({
          outcome: 'paused',
          message: `"${action.title}" failed: ${step.message}`,
          steps,
          pausedAt: first + offset,
          postLaunchPending: 0,
          minimize: false,
        });
      }
    }

    const title = profile.name;
    report('launch', 'game', title, 'running');
    const fail = (message: string): Result<LaunchResult> => {
      steps.push({ itemId: 'game', title, ok: false, message, phase: 'launch' });
      report('launch', 'game', title, 'failed', message);
      return ok({ outcome: 'failed', message, steps, postLaunchPending: 0, minimize: false });
    };
    const target = await this.launchTarget(profile);
    if (!target.ok) return fail(target.error.message);
    const shown = profile.steamAppId ? 'Steam' : baseName(target.value.exe);
    const started = await this.ctx.ports.processes.start({
      exe: target.value.exe,
      args: target.value.args,
      ...(target.value.cwd ? { cwd: target.value.cwd } : {}),
    });
    if (!started.ok) {
      return fail(
        /ENOENT|not found|cannot find/i.test(started.error.detail ?? '')
          ? `${shown} not found at ${target.value.exe}`
          : `${started.error.message}${started.error.detail ? ` ${started.error.detail}` : ''}`
      );
    }
    // "Launched" only once the game (or Steam's handoff) is really running.
    const deadline = this.ctx.ports.clock.now().getTime() + this.launchConfirmMs;
    const expected = baseName(target.value.exe);
    for (;;) {
      if (await this.isRunning(expected)) break;
      if (this.ctx.ports.clock.now().getTime() >= deadline) {
        return fail(
          `Started ${shown} but it is not running after ${Math.round(this.launchConfirmMs / 1000)} s`
        );
      }
      await this.sleep(500);
    }
    const launchedAt = this.ctx.ports.clock.now().getTime();
    const message = profile.steamAppId
      ? `Asked Steam to start ${profile.name}`
      : `Launched ${shown}`;
    steps.push({ itemId: 'game', title, ok: true, message, phase: 'launch' });
    report('launch', 'game', title, 'done', message);
    this.ctx.log.info(`launched ${target.value.exe}`, { pid: started.value.pid });

    // Post-launch actions run once the game is up, each at its delay after the start.
    const post = actions.postLaunch;
    for (const action of post) report('postLaunch', action.id, action.title, 'pending');
    void (async () => {
      for (const action of post) {
        const wait = launchedAt + action.delaySeconds * 1000 - this.ctx.ports.clock.now().getTime();
        if (wait > 0) await this.sleep(wait);
        report('postLaunch', action.id, action.title, 'running');
        const step = await runAction(action, this.ctx.checks, this.ctx, {
          timer: this.timer,
          approved,
        });
        if (step.ok) {
          const program = startedProgram(action);
          if (program && action.closeOnStandDown !== false) this.startedByActions.add(program);
        } else {
          // Never touches the game: a failure here is reported and logged, nothing more.
          this.ctx.log.warn(`post-launch action ${action.title} failed`, step.message);
        }
        report(
          'postLaunch',
          action.id,
          action.title,
          step.skipped ? 'skipped' : step.ok ? 'done' : 'failed',
          step.message
        );
      }
    })();

    const prefs = await this.preferences();
    return ok({
      outcome: 'launched',
      message,
      steps,
      postLaunchPending: post.length,
      minimize: prefs.ok ? prefs.value.minimizeOnLaunch : true,
    });
  }

  // ---- stand down ----

  async standDown(
    profileId: string,
    options: { closeGame?: boolean } = {}
  ): Promise<Result<ActionReport & { headline: string }>> {
    const found = await this.profile(profileId);
    if (!found.ok) return found;
    const profile = found.value.profile;
    const game = profile.launch && !profile.steamAppId ? baseName(profile.launch.exe) : undefined;
    // The game itself is closed only when the user said so.
    const skipItems = new Set(
      profile.checks
        .filter((c) => {
          const name = c.params['name'];
          return (
            game && c.type === 'process.running' && typeof name === 'string' && sameName(name, game)
          );
        })
        .map((c) => c.id)
    );
    const closeGracefully = async (name: string, title: string): Promise<StepResult | null> => {
      const list = await this.ctx.ports.processes.list();
      if (!list.ok) return { itemId: name, title, ok: false, message: list.error.message };
      const targets = list.value.filter((p) => sameName(p.name, name));
      if (targets.length === 0) return null;
      for (const target of targets) {
        const closed = await this.ctx.ports.processes.close(target.pid, {
          waitMs: 10_000,
          force: false,
        });
        if (!closed.ok) {
          return {
            itemId: name,
            title,
            ok: false,
            message: `${name} is still running: it did not close when asked.`,
          };
        }
      }
      return { itemId: name, title, ok: true, message: `Closed ${name}` };
    };

    const report = await standDown(profile, this.ctx.checks, this.ctx, {
      timeoutMs: await this.timeoutMs(),
      skipItems,
      between: async () => {
        const steps: StepResult[] = [];
        if (options.closeGame && game) {
          const closed = await closeGracefully(game, profile.name);
          if (closed) steps.push(closed);
        }
        // Programs a launch action started this session.
        for (const program of [...this.startedByActions]) {
          const closed = await closeGracefully(program, program);
          if (closed) steps.push(closed);
          if (!closed || closed.ok) this.startedByActions.delete(program);
        }
        for (const action of profileActions(profile).standDown) {
          steps.push(
            await runAction(action, this.ctx.checks, this.ctx, {
              timer: this.timer,
              // Stand-down actions are run deliberately by pressing Stand down.
              approved: new Set([action.id]),
            })
          );
        }
        return steps;
      },
    });

    const steps = [...report.steps];
    const settings = await this.ctx.settings.get();
    const deskLayout = settings.ok ? settings.value.deskLayoutId : undefined;
    if (!deskLayout && !steps.some((s) => /layout/i.test(s.message))) {
      steps.push({
        itemId: 'displays.noDeskLayout',
        title: 'Desk monitor layout',
        ok: true,
        skipped: true,
        message: 'No desk layout is chosen in Settings, so the monitors were left as they are',
      });
    }
    const closed = steps.filter((s) => s.ok && s.message.startsWith('Closed ')).length;
    const failed = steps.filter((s) => !s.ok).length;
    const parts = [
      closed > 0 ? `Closed ${closed} ${closed === 1 ? 'app' : 'apps'}` : 'No apps to close',
      ...(failed > 0 ? [`${failed} ${failed === 1 ? 'step' : 'steps'} need attention`] : []),
    ];
    this.ctx.log.info(`stand down ${profileId}`, steps);
    return ok({ ...report, steps, headline: parts.join(' · ') });
  }

  // ---- preferences ----

  async preferences(): Promise<Result<Preferences>> {
    return this.prefs.read();
  }

  async setPreferences(patch: Partial<Preferences>): Promise<Result<Preferences>> {
    return this.prefs.update((current) => ({ ...current, ...patch }));
  }
}
