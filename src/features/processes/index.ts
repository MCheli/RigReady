import { defineFeature } from '../../shared/feature';

/**
 * No screens of its own: this feature contributes the app check, its fix and its capture,
 * and a section on the Settings page for the apps the user asked to be offered in every
 * new setup.
 */
export default defineFeature({
  id: 'processes',
  checkTypes: [{ type: 'process.running', label: 'App running', group: 'apps' }],
  remediationTypes: [{ type: 'process.launch', label: 'Start the app' }],
  settings: [
    {
      title: 'Apps offered in new setups',
      component: () => import('./renderer/OwnAppsSettings.vue'),
      order: 350,
    },
  ],
});
