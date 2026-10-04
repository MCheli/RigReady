import { defineCommands } from '../../shared/feature';

/** The racing games' pages for the command palette, under the names of the games. */
export default defineCommands({
  feature: 'racing',
  commands: [
    {
      id: 'racing.iracing',
      title: 'iRacing',
      icon: 'mdi-steering',
      keywords: ['racing', 'controls.cfg', 'wheel calibration'],
      to: '/configure/racing/iracing',
    },
    {
      id: 'racing.lmu',
      title: 'Le Mans Ultimate',
      icon: 'mdi-steering',
      keywords: ['racing', 'lmu', 'force feedback'],
      to: '/configure/racing/lmu',
    },
    {
      id: 'racing.beamng',
      title: 'BeamNG.drive',
      icon: 'mdi-steering',
      keywords: ['racing', 'inputmaps', 'force feedback'],
      to: '/configure/racing/beamng',
    },
    {
      id: 'racing.assetto-corsa',
      title: 'Assetto Corsa',
      icon: 'mdi-steering',
      keywords: ['racing', 'controls.ini', 'force feedback'],
      to: '/configure/racing/assetto-corsa',
    },
    {
      // The navigation entry keeps its name; these are more words it is found by.
      id: 'racing.wheel',
      title: 'Fanatec wheel base',
      keywords: ['fanatec', 'force feedback', 'dd2', 'tuning'],
      to: '/configure/racing/wheel',
    },
  ],
});
