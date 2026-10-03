import { defineFeatureMain } from '../../core/feature';
import {
  createLaunchRemediation,
  createProcessRunningCheck,
  pathResolver,
  createProcessCapture,
  SessionStarts,
} from './core/processCheck';

export default defineFeatureMain({
  id: 'processes',
  setup(ctx) {
    // Shared by the check and its fix: Stand down closes what Make ready started.
    const session = new SessionStarts();
    const resolve = pathResolver(ctx.games);
    ctx.checks.registerCheck(createProcessRunningCheck(session, resolve));
    ctx.checks.registerRemediation(createLaunchRemediation(session, resolve));
    ctx.checks.registerCapture(createProcessCapture(ctx.games));
  },
});
