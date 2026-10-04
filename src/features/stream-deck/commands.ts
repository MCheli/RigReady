import { defineCommands } from '../../shared/feature';

/** Stream Deck for the command palette: the guided setup and the tabs under their names. */
export default defineCommands({
  feature: 'stream-deck',
  commands: [
    {
      id: 'stream-deck.setup',
      title: 'Set up Stream Deck on a new PC',
      icon: 'mdi-list-status',
      keywords: ['install', 'guide', 'reinstall', 'elgato'],
      to: '/configure/stream-deck/setup',
    },
    {
      id: 'stream-deck.profiles',
      title: 'Stream Deck: Profiles and plugins',
      icon: 'mdi-view-grid-outline',
      keywords: ['elgato', 'inventory'],
      to: '/configure/stream-deck?tab=profiles',
    },
    {
      id: 'stream-deck.backups',
      title: 'Stream Deck: Backups',
      icon: 'mdi-backup-restore',
      keywords: ['elgato', 'restore'],
      to: '/configure/stream-deck?tab=backups',
    },
  ],
});
