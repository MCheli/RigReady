import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'games',
  nav: [
    {
      title: 'Games',
      icon: 'mdi-gamepad-variant-outline',
      to: '/configure/games',
      order: 110,
      section: 'Setup',
    },
  ],
  routes: [{ path: '/configure/games', component: () => import('./renderer/GamesPage.vue') }],
});
