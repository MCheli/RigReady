import { defineFeature } from '../../shared/feature';
import KeepLayoutPrompt from './renderer/KeepLayoutPrompt.vue';

export default defineFeature({
  id: 'displays',
  nav: [
    {
      title: 'Monitors',
      icon: 'mdi-monitor-multiple',
      to: '/configure/displays',
      order: 310,
      section: 'Hardware',
    },
  ],
  routes: [{ path: '/configure/displays', component: () => import('./renderer/DisplaysPage.vue') }],
  overlays: [KeepLayoutPrompt],
  checkTypes: [{ type: 'display.layout', label: 'Monitor layout', group: 'displays' }],
  remediationTypes: [{ type: 'display.applyLayout', label: 'Apply the monitor layout' }],
});
