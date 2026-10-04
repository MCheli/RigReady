import { defineFeature } from '../../shared/feature';
import Presence from './renderer/Presence.vue';

export default defineFeature({
  id: 'fly',
  routes: [
    {
      path: '/fly',
      component: () => import('./renderer/FlyPage.vue'),
      meta: { mode: 'fly', title: 'Fly' },
    },
    {
      // The compact view: opened as a small window that stays on top (Fly menu).
      path: '/fly/compact',
      component: () => import('./renderer/CompactPage.vue'),
      meta: { mode: 'fly', title: 'Compact view' },
    },
  ],
  overlays: [Presence],
});
