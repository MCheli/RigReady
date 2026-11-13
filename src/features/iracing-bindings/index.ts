import { defineFeature } from '../../shared/feature';

/** A page and nothing else: reached from the one Bindings entry and its game picker. */
export default defineFeature({
  id: 'iracing-bindings',
  bindings: [{ game: 'iracing', name: 'iRacing', to: '/configure/iracing-bindings', order: 20 }],
  routes: [
    {
      path: '/configure/iracing-bindings',
      component: () => import('./renderer/IracingBindingsPage.vue'),
    },
  ],
});
