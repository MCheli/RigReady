import { bind, defineFeatureMain } from '../../core/feature';
import { audioContract } from './contract';
import {
  audioCapture,
  audioDefaultCheck,
  createAudioStandDown,
  createSetDefaultRemediation,
  PreviousDefaults,
} from './core/audio';
import { readView, setDefaultFromPage } from './core/view';

export default defineFeatureMain({
  id: 'audio',
  setup(ctx) {
    const previous = new PreviousDefaults();
    ctx.checks.registerCheck({ ...audioDefaultCheck, standDown: createAudioStandDown(previous) });
    ctx.checks.registerRemediation(createSetDefaultRemediation(previous));
    ctx.checks.registerCapture(audioCapture);
    return [
      bind(audioContract, {
        view: () => readView(ctx.ports.audio),
        setDefault: ({ id, role }) => setDefaultFromPage(ctx.ports.audio, id, role),
      }),
    ];
  },
});
