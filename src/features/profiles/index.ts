import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'profiles',
  nav: [
    {
      title: 'Setups',
      icon: 'mdi-clipboard-check-outline',
      to: '/configure/profiles',
      order: 100,
      section: 'Setup',
    },
  ],
  routes: [
    { path: '/configure/profiles', component: () => import('./renderer/ProfilesPage.vue') },
    { path: '/configure/profiles/capture', component: () => import('./renderer/CapturePage.vue') },
    {
      path: '/configure/profiles/:id',
      component: () => import('./renderer/ProfileEditPage.vue'),
      props: true,
    },
  ],
});
