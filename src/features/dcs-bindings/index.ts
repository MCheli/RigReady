import { defineFeature } from '../../shared/feature';
import MigrationOpener from './renderer/MigrationOpener.vue';

export default defineFeature({
  id: 'dcs-bindings',
  nav: [
    {
      title: 'DCS bindings',
      icon: 'mdi-controller',
      to: '/configure/dcs-bindings',
      order: 300,
      section: 'Controls',
    },
  ],
  routes: [
    {
      path: '/configure/dcs-bindings/:tab?',
      component: () => import('./renderer/BindingsPage.vue'),
    },
  ],
  overlays: [MigrationOpener],
  checkTypes: [
    {
      type: 'dcs-bindings.deviceIds',
      label: 'DCS bindings match the connected devices',
      group: 'files',
    },
  ],
  remediationTypes: [{ type: 'dcs-bindings.openMigration', label: 'Review device ID changes' }],
});
