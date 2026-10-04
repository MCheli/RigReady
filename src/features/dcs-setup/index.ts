import { defineFeature } from '../../shared/feature';

export default defineFeature({
  id: 'dcs-setup',
  nav: [
    {
      title: 'DCS World',
      icon: 'mdi-airplane',
      to: '/configure/dcs',
      order: 210,
      section: 'Games',
    },
  ],
  routes: [
    {
      // One nav entry; the pages are tabs under it, so the entry stays highlighted on each.
      path: '/configure/dcs',
      component: () => import('./renderer/DcsLayout.vue'),
      children: [
        { path: '', component: () => import('./renderer/DcsOverviewPage.vue') },
        { path: 'screens', component: () => import('./renderer/DcsScreensPage.vue') },
        { path: 'export', component: () => import('./renderer/DcsExportPage.vue') },
        { path: 'simapppro', component: () => import('./renderer/DcsSimAppProPage.vue') },
      ],
    },
  ],
  checkTypes: [
    { type: 'dcs.install', label: 'DCS World installed', group: 'other' },
    { type: 'dcs.monitorSetup', label: 'DCS monitor setup fits the monitors', group: 'displays' },
    { type: 'dcs.exportLua', label: 'Export.lua loads the tools this setup needs', group: 'files' },
    { type: 'dcs.options', label: 'DCS graphics options', group: 'files' },
    { type: 'dcs.simAppProRunning', label: 'SimAppPro running', group: 'apps' },
    { type: 'dcs.managedFiles', label: 'DCS files RigReady manages are unchanged', group: 'files' },
  ],
  remediationTypes: [
    { type: 'dcs.writeScreenSetup', label: 'Write the RigReady screen setup' },
    { type: 'dcs.repairExportLua', label: 'Put back the missing Export.lua lines' },
    { type: 'dcs.setOptions', label: 'Set the DCS options' },
    { type: 'dcs.startSimAppPro', label: 'Start SimAppPro' },
    { type: 'dcs.restoreManaged', label: "Restore RigReady's version" },
  ],
});
