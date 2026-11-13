import {
  commandFailed,
  defineCommands,
  type CommandOutcome,
  type CommandShell,
  type PaletteCommand,
} from '../../shared/feature';
import { displaysContract, type LayoutView } from './contract';

/**
 * Monitors for the command palette: apply a saved layout, and Identify. Applying goes the
 * way it does on the Monitors page: the layout is applied, "Keep this layout?" is asked on
 * whatever screen is open, and the outcome reported here is the answer to that question,
 * so a layout that went back is never reported as applied.
 */

const PAGE = '/configure/displays';
const openMonitors = { label: 'Open Monitors', to: PAGE };

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function hintOf(layout: LayoutView): string {
  if (layout.status === 'current') return 'The monitors are arranged like this now';
  if (layout.status === 'incomplete') return `Not connected: ${layout.missing.join(', ')}`;
  return count(layout.differences.length, 'difference');
}

async function apply(shell: CommandShell, layout: LayoutView): Promise<CommandOutcome> {
  const api = shell.client(displaysContract);
  // The apply call answers only once "Keep this layout?" has been answered. The question
  // being asked is the sign that the monitors were changed at all.
  let asked = false;
  const off = api.on('applied', () => {
    asked = true;
    shell.progress(`Applied "${layout.name}". Keep it, or it goes back by itself…`);
  });
  try {
    shell.progress(`Applying the ${layout.name} layout…`);
    const applied = await api.applyLayout({ id: layout.id, withoutMissing: false });
    if (asked) shell.machineChanged();
    if (!applied.ok) {
      if (applied.error.code !== 'display.revert') {
        return commandFailed(applied.error, openMonitors);
      }
      return {
        tone: 'bad',
        text: `The ${layout.name} layout was not kept, and the monitors could not be put back`,
        detail: 'Open Monitors to see how they are arranged now.',
        action: openMonitors,
      };
    }
    if (!applied.value.kept) {
      return {
        tone: 'warn',
        text: `The ${layout.name} layout was not kept`,
        detail: 'The monitors are back the way they were.',
        action: openMonitors,
      };
    }
    // No question was asked: nothing had to change, and the answer says so.
    if (!asked) return { tone: 'info', text: applied.value.message };
    return { tone: 'ok', text: `${applied.value.message}, and kept` };
  } finally {
    off();
  }
}

async function identify(shell: CommandShell): Promise<CommandOutcome> {
  const shown = await shell.client(displaysContract).identify();
  if (!shown.ok) return commandFailed(shown.error, openMonitors);
  const { shown: on, off } = shown.value;
  return {
    tone: 'ok',
    text: `Each monitor that is on shows its number (${on})`,
    ...(off > 0
      ? { detail: `${count(off, 'monitor is', 'monitors are')} off and shows nothing.` }
      : {}),
  };
}

export default defineCommands({
  feature: 'displays',
  commands: [
    {
      id: 'displays.identify',
      title: 'Identify monitors',
      hint: 'Shows each monitor its number',
      icon: 'mdi-numeric',
      keywords: ['which', 'screen', 'display', 'number'],
      run: identify,
    },
    {
      // The navigation entry keeps its name; these are more words it is found by.
      id: 'displays.page',
      title: 'Monitor layouts',
      keywords: ['displays', 'screens', 'arrangement'],
      to: PAGE,
    },
  ],
  async list(shell) {
    const view = await shell.client(displaysContract).view();
    if (!view.ok) throw new Error(view.error.message);
    return view.value.layouts.map((layout): PaletteCommand => ({
      id: `displays.apply.${layout.id}`,
      title: `Apply layout: ${layout.name}`,
      hint: hintOf(layout),
      icon: 'mdi-monitor-arrow-down-variant',
      keywords: ['monitors', 'arrange', 'screens', ...(layout.isDesk ? ['desk'] : [])],
      run: (inner) => apply(inner, layout),
    }));
  },
});
