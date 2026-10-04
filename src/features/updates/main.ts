import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { updatesContract } from './contract';
import { UpdateController } from './core/controller';
import { runningGame } from './core/games';

let controller: UpdateController | undefined;

export default defineFeatureMain({
  id: 'updates',
  setup(ctx) {
    const updates = new UpdateController({
      feed: ctx.ports.updates,
      settings: ctx.settings,
      clock: ctx.ports.clock,
      log: ctx.log,
      runningGame: () => runningGame(ctx),
      onStatus: (status) => ctx.emit(updatesContract, 'status', status),
    });
    controller = updates;
    void updates.start();
    return [
      bind(updatesContract, {
        status: async () => ok(updates.status()),
        check: () => updates.check(),
        install: () => updates.install(),
        setPreferences: (patch) => updates.setPreferences(patch),
      }),
    ];
  },
  /** On quit: decides whether the downloaded update is installed on the way out. */
  async dispose() {
    await controller?.beforeQuit();
    controller?.stop();
  },
});
