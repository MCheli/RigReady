import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { displaysContract } from './contract';
import {
  createApplyLayoutRemediation,
  displayCapture,
  displayLayoutCheck,
  LayoutParamsSchema,
} from './core/layoutCheck';
import { RevertGuard } from './core/revertGuard';

export default defineFeatureMain({
  id: 'displays',
  setup(ctx) {
    const guard = new RevertGuard(ctx.ports.displays, {
      armed: (seconds) => ctx.emit(displaysContract, 'applied', { seconds }),
      settled: (outcome) => {
        ctx.log.info(`display layout ${outcome}`);
        ctx.emit(displaysContract, 'settled', { outcome });
      },
    });

    ctx.checks.registerCheck({
      ...displayLayoutCheck,
      params: LayoutParamsSchema,
      // Stand down puts back the layout from before Make ready changed it.
      async standDown() {
        if (!ctx.ports.displays.canRevert()) return ok(null);
        const reverted = await guard.revertNow();
        return reverted.ok ? ok('Restored the earlier monitor layout') : reverted;
      },
    });
    ctx.checks.registerRemediation(createApplyLayoutRemediation(guard));
    ctx.checks.registerCapture(displayCapture);

    return [
      bind(displaysContract, {
        read: () => ctx.ports.displays.read(),
        pending: async () => ok({ pending: guard.pending, seconds: guard.seconds }),
        keep: async () => {
          const was = guard.pending;
          guard.keep();
          return ok({ kept: was });
        },
        revert: () => guard.revertNow(),
      }),
    ];
  },
});
