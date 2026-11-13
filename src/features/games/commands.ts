import { defineCommands } from '../../shared/feature';

/** The Games page's dialog for a game RigReady does not know, opened from the palette. */
export const ADD_GAME_ROUTE = '/configure/games?add=1';

export default defineCommands({
  feature: 'games',
  commands: [
    {
      id: 'games.add',
      title: 'Add a game',
      hint: 'A game RigReady does not know: its program and settings folders',
      icon: 'mdi-plus',
      keywords: ['new game', 'own game', 'custom game', 'another game', 'define'],
      // Opens the dialog; nothing is added until the user saves it there.
      async run(shell) {
        await shell.go(ADD_GAME_ROUTE);
      },
    },
  ],
});
