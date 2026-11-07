import { defineFeature } from '../../shared/feature';
import SecurityUpdateNotice from './renderer/SecurityUpdateNotice.vue';

/**
 * Updates of RigReady itself: two sections at the end of the Settings page, and on every
 * screen the notice for a security release.
 */
export default defineFeature({
  id: 'updates',
  overlays: [SecurityUpdateNotice],
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
