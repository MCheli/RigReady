import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'trackir',
  nav: [
    {
      title: 'TrackIR',
      icon: 'mdi-head-sync-outline',
      to: '/configure/trackir',
      order: 340,
      section: 'Hardware',
    },
  ],
  routes: [{ path: '/configure/trackir', component: () => import('./renderer/TrackIrPage.vue') }],
  checkTypes: [
    { type: 'trackir.running', label: 'TrackIR running', group: 'apps' },
    { type: 'trackir.connected', label: 'TrackIR camera connected', group: 'devices' },
  ],
  remediationTypes: [{ type: 'trackir.start', label: 'Start TrackIR' }],
});
