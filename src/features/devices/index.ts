import { defineFeature } from '../../shared/feature';
import WindowVisibility from './renderer/WindowVisibility.vue';

export default defineFeature({
  id: 'devices',
  nav: [
    {
      title: 'Devices',
      icon: 'mdi-controller-classic-outline',
      to: '/configure/devices',
      order: 300,
      section: 'Hardware',
    },
  ],
  routes: [
    {
      path: '/configure/devices',
      component: () => import('./renderer/DevicesLayout.vue'),
      children: [
        { path: '', component: () => import('./renderer/DevicesPage.vue') },
        { path: 'test', component: () => import('./renderer/InputTesterPage.vue') },
        { path: 'health', component: () => import('./renderer/HealthPage.vue') },
        { path: 'usb', component: () => import('./renderer/UsbMapPage.vue') },
      ],
    },
  ],
  overlays: [WindowVisibility],
  settings: [
    {
      title: 'Device notifications',
      component: () => import('./renderer/NotificationSettings.vue'),
      order: 300,
    },
  ],
  checkTypes: [{ type: 'device.connected', label: 'Device connected', group: 'devices' }],
});
