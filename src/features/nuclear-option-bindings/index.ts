import { defineFeature } from '../../shared/feature';

/** A page and nothing else: reached from the one Bindings entry and its game picker. */
export default defineFeature({
  id: 'nuclear-option-bindings',
  bindings: [
    {
      game: 'nuclear-option',
      name: 'Nuclear Option',
      to: '/configure/nuclear-option-bindings',
      order: 30,
    },
  ],
  routes: [
    {
      path: '/configure/nuclear-option-bindings',
      component: () => import('./renderer/NuclearOptionBindingsPage.vue'),
    },
  ],
});
