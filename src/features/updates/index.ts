import { defineFeature } from '../../shared/feature';

/** Updates of RigReady itself: two sections at the end of the Settings page. */
export default defineFeature({
  id: 'updates',
  settings: [
    {
      title: 'Updates',
      component: () => import('./renderer/UpdateSettings.vue'),
      order: 900,
    },
    {
      title: 'About',
      component: () => import('./renderer/AboutSection.vue'),
      order: 990,
    },
  ],
});
