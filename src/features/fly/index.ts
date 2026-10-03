import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'fly',
  routes: [
    {
      path: '/fly',
      component: () => import('./renderer/FlyPage.vue'),
      meta: { mode: 'fly', title: 'Fly' },
    },
  ],
});
