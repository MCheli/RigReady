import { defineCommands } from '../../shared/feature';

/**
 * The page has no navigation entry yet, so the command palette is how it is found. It is
 * listed with the other pages, under "Go to", and names no heading of its own: a heading
 * here once stood above Play's, because a feature without a navigation entry was listed
 * first.
 */
export default defineCommands({
  feature: 'iracing-bindings',
  commands: [
    {
      id: 'iracing-bindings.open',
      title: 'iRacing bindings',
      hint: 'What each button and key does in iRacing',
      icon: 'mdi-steering',
      keywords: ['iracing', 'controls', 'buttons', 'keys', 'controls.cfg', 'cars'],
      to: '/configure/iracing-bindings',
    },
  ],
});
