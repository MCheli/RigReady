import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'ai-assist',
  nav: [
    {
      title: 'Binding guide',
      icon: 'mdi-school-outline',
      to: '/configure/ai-assist',
      order: 310,
      section: 'Controls',
    },
  ],
  routes: [
    {
      path: '/configure/ai-assist/:tab?',
      component: () => import('./renderer/GuidePage.vue'),
    },
  ],
  settings: [
    { title: 'AI binding help', component: () => import('./renderer/AiSettings.vue'), order: 100 },
  ],
});
