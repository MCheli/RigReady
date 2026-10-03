import { defineFeatureMain } from '../../core/feature';
import { createLaunchRemediation, processCapture, processRunningCheck } from './core/processCheck';

export default defineFeatureMain({
  id: 'processes',
  setup(ctx) {
    ctx.checks.registerCheck(processRunningCheck);
    ctx.checks.registerRemediation(createLaunchRemediation());
    ctx.checks.registerCapture(processCapture);
  },
});
