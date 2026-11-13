import { defineCommands } from '../../shared/feature';

/** The page has no navigation entry yet, so the command palette is how it is found. */
export default defineCommands({
  feature: 'iracing-bindings',
  commands: [
    {
      id: 'iracing-bindings.open',
      title: 'iRacing bindings',
      icon: 'mdi-steering',
      group: 'Bindings',
      keywords: ['iracing', 'controls', 'buttons', 'keys', 'controls.cfg', 'cars'],
      to: '/configure/iracing-bindings',
    },
  ],
});
