import path from 'node:path';
import { bind, defineFeatureMain } from '../../core/feature';
import { STAND_DOWN_DEFAULT_SECONDS, standDownOnClose } from '../../core/profile/standDownOnClose';
import { ok, type Result } from '../../core/result';
import { flyContract } from './contract';
import { Fly } from './core/fly';
import { rigGlance } from './core/rig';
import { problemText } from './core/sessionText';
import { SessionLog, SessionTracker } from './core/sessions';
import { suggestSetup } from './core/suggest';
import { ProfileWatcher } from './core/watch';
import { welcome } from './core/welcome';

let watcher: ProfileWatcher | undefined;
let tracker: SessionTracker | undefined;

/** An area no window can be outside of: "show it where it is". */
const WHOLE_DESKTOP = { x: -1_000_000, y: -1_000_000, width: 2_000_000, height: 2_000_000 };

export default defineFeatureMain({
  id: 'fly',
  setup(ctx) {
    const sessionLog = new SessionLog(
      ctx.ports.files,
      path.join(ctx.ports.folders.dataRoot(), 'fly')
    );
    /**
     * Shows the main window where it is when that monitor is on, and on the main monitor
     * when the one it was left on has been switched off since (a game layout does that).
     */
    const showMain = async (): Promise<Result<{ shown: boolean }>> => {
      const layout = await ctx.ports.displays.read();
      const on = layout.ok
        ? layout.value.displays
            .filter((d) => d.enabled && d.width > 0 && d.height > 0)
            .sort((a, b) => Number(b.primary) - Number(a.primary))
            .map(({ x, y, width, height }) => ({ x, y, width, height }))
        : [];
      // The monitors could not be read: the window is still shown, wherever it is.
      const shown = await ctx.ports.window.showOn(on.length > 0 ? on : [WHOLE_DESKTOP]);
      return shown.ok ? ok({ shown: true }) : shown;
    };
    const sessions = new SessionTracker(ctx, sessionLog, {
      emit: (state) => ctx.emit(flyContract, 'session', state),
      // Stand down by itself once the countdown is over: the same Stand down the button
      // runs. The game is gone already, so there is nothing to ask about closing it.
      standDown: async (profileId) => {
        const down = await fly.standDown(profileId, { closeGame: false });
        if (!down.ok) return down;
        const failed = down.value.steps.filter((step) => !step.ok && !step.skipped);
        return ok({
          headline: down.value.headline,
          failed: failed.length,
          problems: failed.map(problemText),
        });
      },
      // Each setup has its own answer; one saved before the question existed gets the
      // defaults (on, one minute).
      standDownOnClose: async (profileId) => {
        const found = await fly.profile(profileId);
        // A setup that cannot be read cannot be stood down either: nothing starts by itself.
        if (!found.ok) return { enabled: false, seconds: STAND_DOWN_DEFAULT_SECONDS };
        return standDownOnClose(found.value.profile);
      },
      // Said with the countdown: a desk layout never kept with these monitors asks to be
      // kept, and nobody may be there to answer.
      standDownNeedsYou: (profileId) => fly.standDownNeedsYou(profileId),
      // The countdown is there to be seen and cancelled: the window that hid itself for
      // the game comes back for it. The game has closed, so nothing loses the screen to it.
      showWindow: async () => {
        const shown = await showMain();
        if (!shown.ok) ctx.log.warn('the window could not be shown for the countdown', shown.error);
      },
    });
    tracker = sessions;
    const fly: Fly = new Fly(
      ctx,
      {
        result: (payload) => ctx.emit(flyContract, 'result', payload),
        progress: (payload) => ctx.emit(flyContract, 'progress', payload),
        launchProgress: (payload) => ctx.emit(flyContract, 'launchProgress', payload),
        switched: (profileId) => ctx.emit(flyContract, 'activeChanged', { profileId }),
      },
      { sessions, sessionLog }
    );
    watcher = new ProfileWatcher(ctx.ports.files, ctx.profiles.dir, (ids) =>
      ctx.emit(flyContract, 'profilesChanged', { ids })
    );
    const watching = watcher;
    return [
      bind(flyContract, {
        state: () => fly.state(),
        welcome: async () => ok(await welcome(ctx)),
        view: ({ profileId }) => fly.profileView(profileId),
        check: ({ profileId, runId, remember }) => fly.check(profileId, runId, remember),
        checkItem: ({ profileId, itemId }) => fly.checkItem(profileId, itemId),
        fix: ({ profileId, itemId, confirmed }) => fly.fix(profileId, itemId, confirmed),
        makeReady: ({ profileId, runId, approved }) =>
          fly.makeReady(profileId, {
            ...(approved ? { approved } : {}),
            ...(runId ? { runId } : {}),
          }),
        gameStatus: ({ profileId }) => fly.gameStatus(profileId),
        standDown: ({ profileId, closeGame }) => fly.standDown(profileId, { closeGame }),
        launch: ({ profileId, runId, resumeAfter, approved }) =>
          fly.launch(profileId, {
            approved,
            ...(runId ? { runId } : {}),
            ...(resumeAfter !== undefined ? { resumeAfter } : {}),
          }),
        acknowledge: ({ profileId, itemId }) => fly.acknowledge(profileId, itemId),
        preferences: () => fly.preferences(),
        setPreferences: (patch) => fly.setPreferences(patch),
        watch: async () => {
          await watching.start();
          return ok({ watching: true });
        },
        rig: async ({ profileId }) => {
          const found = await fly.profile(profileId);
          if (!found.ok) return found;
          return ok(await rigGlance(ctx, found.value.profile));
        },
        session: async () => ok(await sessions.current()),
        dismissSession: async () => ok(sessions.dismiss()),
        cancelStandDown: async () => ok(sessions.cancelStandDown()),
        history: async () => ok(await sessionLog.history()),
        presence: async ({ window, visible }) => ok(sessions.presence(window, visible)),
        openCompact: () =>
          ctx.ports.window.openPanel({
            id: 'fly-compact',
            route: '/fly/compact?panel=1',
            title: 'RigReady compact',
            width: 400,
            height: 336,
            alwaysOnTop: true,
          }),
        showMain,
        suggestion: async ({ profileId }) => ok(await suggestSetup(ctx, profileId)),
      }),
    ];
  },
  dispose() {
    watcher?.stop();
    tracker?.stop();
  },
});
