import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'sharing',
  nav: [
    {
      title: 'Share',
      icon: 'mdi-share-variant-outline',
      to: '/configure/share',
      order: 130,
      section: 'Setups',
    },
  ],
  routes: [{ path: '/configure/share', component: () => import('./renderer/SharePage.vue') }],
});
