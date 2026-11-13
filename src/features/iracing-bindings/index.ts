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
  checkTypes: [
    {
      type: 'iracing-bindings.controlProfile',
      label: 'iRacing control profile',
      group: 'files',
    },
  ],
  remediationTypes: [
    {
      type: 'iracing-bindings.setControlProfile',
      label: 'Switch iRacing’s control profile',
    },
  ],
});
