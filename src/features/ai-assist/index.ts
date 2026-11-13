import { defineFeature } from '../../shared/feature';
import AssistantButton from './renderer/AssistantButton.vue';
import AssistantPanel from './renderer/AssistantPanel.vue';

export default defineFeature({
  id: 'ai-assist',
  nav: [
    {
      title: 'Binding guide',
      icon: 'mdi-school-outline',
      to: '/configure/ai-assist',
      order: 310,
      section: 'Controls',
      // It works on DCS's and iRacing's own bindings: offered where either is found. A link
      // still opens the page, which says what was not found.
      games: ['dcs', 'iracing'],
    },
  ],
  routes: [
    {
      path: '/configure/ai-assist/:tab?',
      component: () => import('./renderer/GuidePage.vue'),
    },
  ],
  // The built-in assistant: a button in the app bar (once a key is stored) and its panel.
  barItems: [AssistantButton],
  overlays: [AssistantPanel],
  settings: [
    { title: 'AI assistance', component: () => import('./renderer/AiSettings.vue'), order: 100 },
  ],
});
