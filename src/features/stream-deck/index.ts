import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'stream-deck',
  nav: [
    {
      title: 'Stream Deck',
      icon: 'mdi-view-grid-outline',
      to: '/configure/stream-deck',
      order: 330,
      section: 'Hardware',
    },
  ],
  routes: [
    {
      path: '/configure/stream-deck',
      component: () => import('./renderer/StreamDeckPage.vue'),
    },
    {
      path: '/configure/stream-deck/setup',
      component: () => import('./renderer/StreamDeckSetupPage.vue'),
    },
  ],
  checkTypes: [
    { type: 'stream-deck.running', label: 'Stream Deck app running', group: 'apps' },
    { type: 'stream-deck.connected', label: 'Stream Deck connected', group: 'devices' },
  ],
  remediationTypes: [{ type: 'stream-deck.start', label: 'Start Stream Deck' }],
});
