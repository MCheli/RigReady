import { defineFeature } from '../../shared/feature';

/**
 * A page and nothing else: no navigation entry. The Bindings game picker will link to
 * this route; until then it is reached from the command palette (commands.ts) or by link.
 */
export default defineFeature({
  id: 'iracing-bindings',
  routes: [
    {
      path: '/configure/iracing-bindings',
      component: () => import('./renderer/IracingBindingsPage.vue'),
    },
  ],
});
