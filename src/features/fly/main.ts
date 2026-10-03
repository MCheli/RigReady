import { bind, defineFeatureMain } from '../../core/feature';
import { flyContract } from './contract';
import {
  checkProfile,
  flyState,
  launchProfile,
  makeProfileReady,
  standProfileDown,
} from './core/fly';

export default defineFeatureMain({
  id: 'fly',
  setup(ctx) {
    return [
      bind(flyContract, {
        state: () => flyState(ctx),
        check: ({ profileId }) => checkProfile(ctx, profileId),
        makeReady: ({ profileId }) => makeProfileReady(ctx, profileId),
        standDown: ({ profileId }) => standProfileDown(ctx, profileId),
        launch: ({ profileId }) => launchProfile(ctx, profileId),
      }),
    ];
  },
});
