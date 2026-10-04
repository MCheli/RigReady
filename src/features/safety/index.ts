import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'safety',
  nav: [
    {
      title: 'Safety',
      icon: 'mdi-shield-check-outline',
      to: '/configure/safety',
      order: 920,
      section: 'RigReady',
    },
  ],
  routes: [{ path: '/configure/safety', component: () => import('./renderer/SafetyPage.vue') }],
});
