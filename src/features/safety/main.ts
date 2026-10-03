import { bind, defineFeatureMain } from '../../core/feature';
import { safetyContract } from './contract';
import { readSafety, undoGroup } from './core/safety';

export default defineFeatureMain({
  id: 'safety',
  setup(ctx) {
    return [
      bind(safetyContract, {
        journal: () => readSafety(ctx),
        undo: ({ groupId, force }) => undoGroup(ctx, groupId, force),
      }),
    ];
  },
});
