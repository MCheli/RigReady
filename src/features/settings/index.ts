import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'settings',
  nav: [
    {
      title: 'Settings',
      icon: 'mdi-cog-outline',
      to: '/configure/settings',
      order: 910,
      section: 'App',
    },
  ],
  routes: [{ path: '/configure/settings', component: () => import('./renderer/SettingsPage.vue') }],
});
