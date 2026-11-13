import { defineFeature } from '../../shared/feature';
import MigrationOpener from './renderer/MigrationOpener.vue';

export default defineFeature({
  id: 'dcs-bindings',
  // Reached from the one Bindings entry and its game picker, not a menu entry of its own.
  bindings: [{ game: 'dcs', name: 'DCS', to: '/configure/dcs-bindings', order: 10 }],
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
