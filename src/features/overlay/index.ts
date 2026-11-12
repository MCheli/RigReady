import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'overlay',
  nav: [
    {
      title: 'Overlay',
      icon: 'mdi-picture-in-picture-top-right',
      to: '/configure/overlay',
      order: 330,
      section: 'Controls',
    },
  ],
  routes: [
    { path: '/configure/overlay', component: () => import('./renderer/OverlayPage.vue') },
    // What an overlay window shows: one part of the overlay and nothing else, over the game.
    {
      path: '/overlay/:widget',
      component: () => import('./renderer/OverlayWindow.vue'),
      meta: { bare: true, title: 'Overlay' },
    },
  ],
});
