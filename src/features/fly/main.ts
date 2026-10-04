import path from 'node:path';
import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { flyContract } from './contract';
import { Fly } from './core/fly';
import { SessionLog, SessionTracker } from './core/sessions';
import { ProfileWatcher } from './core/watch';
import { welcome } from './core/welcome';

let watcher: ProfileWatcher | undefined;
let tracker: SessionTracker | undefined;

export default defineFeatureMain({
  id: 'fly',
  setup(ctx) {
    const sessionLog = new SessionLog(
      ctx.ports.files,
      path.join(ctx.ports.folders.dataRoot(), 'fly')
    );
    const sessions = new SessionTracker(ctx, sessionLog, {
      emit: (state) => ctx.emit(flyContract, 'session', state),
      // Stand down by itself when the game closes, for the user who asked for that. The
      // game is gone already, so there is nothing to ask about closing it.
      standDown: async (profileId) => {
        const down = await fly.standDown(profileId, { closeGame: false });
        if (!down.ok) return down;
        return ok({
          headline: down.value.headline,
          failed: down.value.steps.filter((step) => !step.ok && !step.skipped).length,
        });
      },
      autoStandDown: async () => {
        const preferences = await fly.preferences();
        return preferences.ok && preferences.value.autoStandDown;
      },
    });
    tracker = sessions;
    const fly: Fly = new Fly(
      ctx,
      {
        result: (payload) => ctx.emit(flyContract, 'result', payload),
        progress: (payload) => ctx.emit(flyContract, 'progress', payload),
        launchProgress: (payload) => ctx.emit(flyContract, 'launchProgress', payload),
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
        session: async () => ok(await sessions.current()),
        dismissSession: async () => ok(sessions.dismiss()),
        history: async () => ok(await sessionLog.history()),
        presence: async ({ window, visible }) => ok(sessions.presence(window, visible)),
      }),
    ];
  },
  dispose() {
    watcher?.stop();
    tracker?.stop();
  },
});
