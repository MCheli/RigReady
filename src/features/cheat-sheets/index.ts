import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'cheat-sheets',
  nav: [
    {
      title: 'Cheat sheets',
      icon: 'mdi-card-text-outline',
      to: '/configure/cheat-sheets',
      order: 320,
      section: 'Controls',
    },
  ],
  routes: [
    { path: '/configure/cheat-sheets', component: () => import('./renderer/CheatSheetsPage.vue') },
    {
      path: '/configure/cheat-sheets/quick',
      component: () => import('./renderer/QuickLookPage.vue'),
    },
    {
      path: '/configure/cheat-sheets/learn',
      component: () => import('./renderer/TrainerPage.vue'),
    },
  ],
  checkTypes: [
    {
      type: 'cheat-sheets.kneeboardCurrent',
      label: 'Cheat sheet kneeboard pages are up to date',
      group: 'files',
    },
  ],
  remediationTypes: [{ type: 'cheat-sheets.regenerate', label: 'Write the kneeboard pages again' }],
});
