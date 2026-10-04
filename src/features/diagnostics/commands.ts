import {
  commandFailed,
  defineCommands,
  type CommandOutcome,
  type CommandShell,
} from '../../shared/feature';
import { diagnosticsContract } from './contract';

/**
 * Diagnostics for the command palette: the report on the clipboard without opening the
 * page, for pasting into a bug report. The toast says how much was really copied.
 */

const PAGE = '/configure/diagnostics';
const openDiagnostics = { label: 'Open Diagnostics', to: PAGE };

async function copyReport(shell: CommandShell): Promise<CommandOutcome> {
  const copied = await shell.client(diagnosticsContract).copy();
  if (!copied.ok) return commandFailed(copied.error, openDiagnostics);
  return {
    tone: 'ok',
    text: 'The diagnostics report is on the clipboard',
    detail: `${copied.value.characters.toLocaleString('en-US')} characters, with personal details removed. Paste it where it is needed.`,
  };
}

export default defineCommands({
  feature: 'diagnostics',
  commands: [
    {
      id: 'diagnostics.copy',
      title: 'Copy the diagnostics report',
      hint: 'Versions, hardware and the recent log',
      icon: 'mdi-content-copy',
      keywords: ['bug', 'report', 'support', 'log', 'clipboard'],
      run: copyReport,
    },
    {
      // The navigation entry keeps its name; these are more words it is found by.
      id: 'diagnostics.page',
      title: 'Log and data files',
      keywords: ['log', 'errors', 'export', 'versions'],
      to: PAGE,
    },
  ],
});
