import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'audio',
  nav: [
    {
      title: 'Audio',
      icon: 'mdi-volume-high',
      to: '/configure/audio',
      order: 320,
      section: 'Hardware',
    },
  ],
  routes: [{ path: '/configure/audio', component: () => import('./renderer/AudioPage.vue') }],
  checkTypes: [{ type: 'audio.defaultDevice', label: 'Default audio device', group: 'audio' }],
  remediationTypes: [{ type: 'audio.setDefault', label: 'Set the default audio device' }],
});
