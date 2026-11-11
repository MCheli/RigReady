import { defineFeature } from '../../shared/feature';
import RunningBadge from './renderer/RunningBadge.vue';

export default defineFeature({
  id: 'virtual-controller',
  nav: [
    {
      title: 'Virtual controller',
      icon: 'mdi-controller',
      to: '/configure/virtual-controller',
      order: 460,
      section: 'Hardware',
    },
  ],
  routes: [
    {
      path: '/configure/virtual-controller',
      component: () => import('./renderer/VirtualControllerPage.vue'),
    },
    {
      path: '/configure/virtual-controller/edit',
      component: () => import('./renderer/ProfileEditor.vue'),
    },
  ],
  overlays: [RunningBadge],
  checkTypes: [
    {
      type: 'virtual-controller.driver',
      label: 'Virtual controller driver installed',
      group: 'apps',
    },
  ],
  remediationTypes: [
    { type: 'virtual-controller.start', label: 'Start a virtual controller' },
    { type: 'virtual-controller.stop', label: 'Stop the virtual controller' },
    { type: 'virtual-controller.installDriver', label: 'Install the virtual controller driver' },
  ],
});
