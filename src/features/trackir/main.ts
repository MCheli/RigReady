import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { trackIrContract } from './contract';
import {
  connectedCheck,
  createStartRemediation,
  runningCheck,
  startTrackIr,
  trackIrCapture,
} from './core/checks';
import { trackIrOverview } from './core/overview';

export default defineFeatureMain({
  id: 'trackir',
  setup(ctx) {
    ctx.checks.registerCheck(runningCheck);
    ctx.checks.registerCheck(connectedCheck);
    ctx.checks.registerRemediation(createStartRemediation());
    ctx.checks.registerCapture(trackIrCapture);
    return [
      bind(trackIrContract, {
        overview: () => trackIrOverview(ctx.ports),
        start: async () => {
          const started = await startTrackIr(ctx.ports);
          return started.ok ? ok({ message: started.value }) : started;
        },
      }),
    ];
  },
});
