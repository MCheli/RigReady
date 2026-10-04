import { defineCommands, type PaletteCommand } from '../../shared/feature';
import { cheatSheetsContract } from './contract';

/**
 * Cheat sheets for the command palette: the quick look under its own name, and one command
 * per aircraft that opens its sheet. Aircraft with bindings of the owner's own come first.
 */

const PAGE = '/configure/cheat-sheets';
const GROUP = 'Cheat sheets';

export default defineCommands({
  feature: 'cheat-sheets',
  commands: [
    {
      id: 'cheat-sheets.quick',
      title: 'Quick look',
      hint: 'Press a control, see what it does',
      icon: 'mdi-card-search-outline',
      keywords: ['cheat sheet', 'which control', 'what does', 'follow my hands'],
      to: `${PAGE}/quick`,
    },
    {
      // The navigation entry keeps its name; these are more words it is found by.
      id: 'cheat-sheets.page',
      title: 'Print or export as kneeboard',
      keywords: ['kneeboard', 'print', 'pdf', 'diagram', 'picture'],
      to: PAGE,
    },
  ],
  async list(shell) {
    const overview = await shell.client(cheatSheetsContract).overview();
    if (!overview.ok) throw new Error(overview.error.message);
    const several = overview.value.games.length > 1;
    return overview.value.games.flatMap((game) =>
      [...game.aircraft]
        .sort(
          (a, b) =>
            Number(b.hasUserBindings) - Number(a.hasUserBindings) || a.name.localeCompare(b.name)
        )
        .map((aircraft): PaletteCommand => ({
          id: `cheat-sheets.sheet.${game.game}.${aircraft.id}`,
          title: `Cheat sheet: ${aircraft.name}`,
          hint: [
            ...(several ? [game.gameName] : []),
            aircraft.hasUserBindings ? 'Your bindings' : 'Defaults only',
          ].join(' · '),
          icon: 'mdi-card-text-outline',
          keywords: [game.gameName, 'sheet', aircraft.id],
          group: GROUP,
          to: `${PAGE}?game=${encodeURIComponent(game.game)}&aircraft=${encodeURIComponent(aircraft.id)}`,
        }))
    );
  },
});
