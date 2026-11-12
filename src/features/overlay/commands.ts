import {
  commandFailed,
  defineCommands,
  type CommandOutcome,
  type CommandShell,
} from '../../shared/feature';
import { overlayContract } from './contract';

const PAGE = '/configure/overlay';
const toPage = { label: 'Open Overlay', to: PAGE };

/** The switch of the Overlay page, from the palette: says what the overlay answered. */
async function turn(shell: CommandShell, on: boolean): Promise<CommandOutcome> {
  const set = await shell.client(overlayContract).set({ on });
  if (!set.ok) return commandFailed(set.error, toPage);
  const state = set.value;
  if (!state.on) return { tone: 'ok', text: 'The overlay is off' };
  const hidden = state.widgets.find((w) => !w.showing);
  if (hidden) {
    return {
      tone: 'warn',
      text: `The overlay is on, but "${hidden.title}" is not showing`,
      ...(hidden.problem ? { detail: hidden.problem } : {}),
      action: toPage,
    };
  }
  if (state.input && !state.input.ok) {
    return {
      tone: 'warn',
      text: 'The overlay is on, but the controllers are not being read',
      ...(state.input.problem ? { detail: state.input.problem } : {}),
      action: toPage,
    };
  }
  const where = state.widgets
    .map((w) => (w.place.screenName ? `${w.title} on ${w.place.screenName}` : w.title))
    .join(', ');
  return {
    tone: 'ok',
    text: 'The overlay is on',
    detail: state.source.problem ?? where,
  };
}

export default defineCommands({
  feature: 'overlay',
  commands: [
    {
      id: 'overlay.page',
      title: 'Overlay',
      to: PAGE,
      keywords: ['in-game', 'on screen', 'presses', 'buttons', 'hud', 'osd', 'history'],
    },
    {
      id: 'overlay.on',
      title: 'Turn the overlay on',
      icon: 'mdi-picture-in-picture-top-right',
      keywords: ['show', 'in-game', 'presses'],
      run: (shell) => turn(shell, true),
    },
    {
      id: 'overlay.off',
      title: 'Turn the overlay off',
      icon: 'mdi-picture-in-picture-top-right-outline',
      keywords: ['hide', 'in-game', 'presses'],
      run: (shell) => turn(shell, false),
    },
  ],
});
