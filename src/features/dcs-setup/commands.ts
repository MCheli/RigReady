import { defineCommands } from '../../shared/feature';

/** DCS World's tabs for the command palette, under the names the tabs carry. */
export default defineCommands({
  feature: 'dcs-setup',
  commands: [
    {
      id: 'dcs-setup.screens',
      title: 'DCS World: Screens',
      icon: 'mdi-monitor-dashboard',
      keywords: ['monitorsetup', 'mfd', 'viewports', 'cockpit displays'],
      to: '/configure/dcs/screens',
    },
    {
      id: 'dcs-setup.export',
      title: 'DCS World: Export.lua',
      icon: 'mdi-script-text-outline',
      keywords: ['export scripts', 'dcs-bios', 'tools'],
      to: '/configure/dcs/export',
    },
    {
      id: 'dcs-setup.simapppro',
      title: 'DCS World: SimAppPro',
      icon: 'mdi-application-cog-outline',
      keywords: ['winwing', 'backlight'],
      to: '/configure/dcs/simapppro',
    },
  ],
});
