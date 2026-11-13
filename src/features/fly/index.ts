import { defineFeature } from '../../shared/feature';
import Presence from './renderer/Presence.vue';
import StandDownBarItem from './renderer/StandDownBarItem.vue';
import StandDownNotice from './renderer/StandDownNotice.vue';

export default defineFeature({
  id: 'fly',
  routes: [
    {
      path: '/fly',
      component: () => import('./renderer/FlyPage.vue'),
      // The screen is called Play; the route, the mode and the feature keep their names.
      meta: { mode: 'fly', title: 'Play' },
    },
    {
      // The compact view: opened as a small window that stays on top (Play menu).
      path: '/fly/compact',
      component: () => import('./renderer/CompactPage.vue'),
      meta: { mode: 'fly', title: 'Compact view' },
    },
  ],
  // On every screen: who is at a window, and the countdown to a Stand down by itself.
  overlays: [Presence, StandDownNotice],
  // In the app bar: the same countdown, once its notice was put away.
  barItems: [StandDownBarItem],
});
