import { defineFeature } from '../../shared/feature';
import ErrorNotice from './renderer/ErrorNotice.vue';

export default defineFeature({
  id: 'diagnostics',
  nav: [
    {
      title: 'Diagnostics',
      icon: 'mdi-stethoscope',
      to: '/configure/diagnostics',
      order: 930,
      section: 'App',
    },
  ],
  routes: [
    { path: '/configure/diagnostics', component: () => import('./renderer/DiagnosticsPage.vue') },
  ],
  // On every screen: the notice for an error nobody expected.
  overlays: [ErrorNotice],
});
