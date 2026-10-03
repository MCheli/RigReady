import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'backup',
  nav: [
    {
      title: 'Backups',
      icon: 'mdi-backup-restore',
      to: '/configure/backups',
      order: 150,
      section: 'Setup',
    },
  ],
  routes: [
    { path: '/configure/backups', component: () => import('./renderer/BackupsPage.vue') },
    {
      path: '/configure/backups/restore/:id',
      component: () => import('./renderer/RestorePage.vue'),
      props: true,
    },
  ],
});
