import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { flyContract } from './contract';
import { Fly } from './core/fly';
import { ProfileWatcher } from './core/watch';

let watcher: ProfileWatcher | undefined;

export default defineFeatureMain({
  id: 'fly',
  setup(ctx) {
    const fly = new Fly(ctx, {
      result: (payload) => ctx.emit(flyContract, 'result', payload),
      progress: (payload) => ctx.emit(flyContract, 'progress', payload),
      launchProgress: (payload) => ctx.emit(flyContract, 'launchProgress', payload),
    });
    watcher = new ProfileWatcher(ctx.ports.files, ctx.profiles.dir, (ids) =>
      ctx.emit(flyContract, 'profilesChanged', { ids })
    );
    const watching = watcher;
    return [
      bind(flyContract, {
        state: () => fly.state(),
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
      }),
    ];
  },
  dispose() {
    watcher?.stop();
  },
});
