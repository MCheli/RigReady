import { bind, defineFeatureMain } from '../../core/feature';
import { oneClickContract } from './contract';
import { MakeReadyHotkey } from './core/hotkey';

let hotkey: MakeReadyHotkey | undefined;

export default defineFeatureMain({
  id: 'one-click',
  setup(ctx) {
    const makeReady = new MakeReadyHotkey(ctx);
    hotkey = makeReady;
    // The hotkey chosen earlier works again as soon as RigReady runs.
    void makeReady.start();
    return [
      bind(oneClickContract, {
        hotkey: () => makeReady.state(),
        setHotkey: ({ hotkey: chosen }) => makeReady.set(chosen),
      }),
    ];
  },
  async dispose() {
    await hotkey?.stop();
  },
});
