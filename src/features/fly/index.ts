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
  ],
  overlays: [Presence],
});
