import { defineFeature } from '../../../../src/shared/feature';

/** The renderer side of the test feature: a navigation entry, two routes, its types. */
export default defineFeature({
  id: 'zz-example',
  nav: [
    {
      title: 'Example',
      icon: 'mdi-lightbulb-outline',
      to: '/configure/zz-example',
      order: 150,
      section: 'Setup',
    },
  ],
  routes: [
    // A real feature loads a page here: () => import('./renderer/ExamplePage.vue').
    { path: '/configure/zz-example', component: { render: () => null } },
    { path: '/configure/zz-example/:id', component: { render: () => null } },
  ],
  checkTypes: [{ type: 'zz-example.lamp', label: 'Example lamp is on', group: 'other' }],
  remediationTypes: [{ type: 'zz-example.switchOn', label: 'Switch the example lamp on' }],
});
