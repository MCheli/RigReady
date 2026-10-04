import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'racing',
  nav: [
    {
      title: 'Racing',
      icon: 'mdi-steering',
      to: '/configure/racing',
      order: 230,
      section: 'Bindings',
    },
    {
      title: 'Wheel',
      icon: 'mdi-tire',
      to: '/configure/racing/wheel',
      order: 330,
      section: 'Hardware',
    },
  ],
  routes: [
    { path: '/configure/racing', component: () => import('./renderer/RacingPage.vue') },
    { path: '/configure/racing/iracing', component: () => import('./renderer/IracingPage.vue') },
    { path: '/configure/racing/lmu', component: () => import('./renderer/LmuPage.vue') },
    { path: '/configure/racing/beamng', component: () => import('./renderer/BeamngPage.vue') },
    {
      path: '/configure/racing/assetto-corsa',
      component: () => import('./renderer/AssettoCorsaPage.vue'),
    },
    { path: '/configure/racing/wheel', component: () => import('./renderer/WheelPage.vue') },
  ],
  remediationTypes: [
    { type: 'racing.restoreBindingSet', label: 'Restore the saved racing bindings' },
  ],
  checkTypes: [
    { type: 'racing.wheelBase', label: 'Wheel base connected in the right mode', group: 'devices' },
    {
      type: 'racing.iracingDevices',
      label: 'iRacing knows the connected controllers',
      group: 'files',
    },
    { type: 'racing.iracingService', label: 'iRacing helper service running', group: 'apps' },
    { type: 'racing.bindingSet', label: 'Racing bindings are the saved set', group: 'files' },
    {
      type: 'racing.wheelSettings',
      label: 'In-game wheel settings as recommended',
      group: 'other',
    },
  ],
});
