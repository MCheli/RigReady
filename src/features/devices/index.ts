import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'devices',
  nav: [
    {
      title: 'Devices',
      icon: 'mdi-usb',
      to: '/configure/devices',
      order: 300,
      section: 'Hardware',
    },
  ],
  routes: [{ path: '/configure/devices', component: () => import('./renderer/DevicesPage.vue') }],
  checkTypes: [{ type: 'device.connected', label: 'Device connected', group: 'devices' }],
});
