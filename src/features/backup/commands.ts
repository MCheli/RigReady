import {
  commandFailed,
  defineCommands,
  type CommandOutcome,
  type CommandShell,
} from '../../shared/feature';
import { backupContract } from './contract';

/**
 * Backups for the command palette: "Back up now" writes the same full backup as the button
 * on the Backups page, shows how far it is, and reports the backup that was really written
 * (its name, how many files, what was left out).
 */

const PAGE = '/configure/backups';
const openBackups = { label: 'Open Backups', to: PAGE };

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

async function backUpNow(shell: CommandShell): Promise<CommandOutcome> {
  const api = shell.client(backupContract);
  shell.progress('Backing up…');
  const off = api.on('progress', ({ done, total }) => {
    if (total > 0) shell.progress(`Backing up… ${done} of ${count(total, 'file')}`);
  });
  try {
    const result = await api.backUp({ scope: { kind: 'full' } });
    if (!result.ok) return commandFailed(result.error, openBackups);
    const { backup, skipped, withheld } = result.value;
    const left = [
      skipped.length > 0 ? `${count(skipped.length, 'file was', 'files were')} skipped` : '',
      withheld.length > 0
        ? `${count(withheld.length, 'file was', 'files were')} left out because they hold credentials`
        : '',
    ].filter(Boolean);
    return {
      tone: skipped.length > 0 ? 'warn' : 'ok',
      text: `Backed up ${count(backup.fileCount, 'file')} (${size(backup.size)}) as "${backup.name}"`,
      ...(left.length > 0 ? { detail: `${left.join('; ')}.` } : {}),
      action: openBackups,
    };
  } finally {
    off();
  }
}

export default defineCommands({
  feature: 'backup',
  commands: [
    {
      id: 'backup.now',
      title: 'Back up now',
      hint: 'Setups, tracked files and settings in one file',
      icon: 'mdi-backup-restore',
      keywords: ['backup', 'save', 'everything', 'full'],
      run: backUpNow,
    },
    {
      id: 'backup.tracked',
      title: 'Tracked files',
      icon: 'mdi-file-eye-outline',
      keywords: ['backups', 'game settings', 'bindings'],
      to: `${PAGE}?tab=tracked`,
    },
    {
      id: 'backup.snapshots',
      title: 'Snapshots',
      icon: 'mdi-camera-outline',
      keywords: ['backups', 'copy', 'restore'],
      to: `${PAGE}?tab=snapshots`,
    },
    {
      id: 'backup.changes',
      title: 'What changed',
      icon: 'mdi-file-compare',
      keywords: ['backups', 'diff', 'compare', 'since it worked'],
      to: `${PAGE}?tab=changes`,
    },
    {
      // The navigation entry keeps its name; these are more words it is found by.
      id: 'backup.page',
      title: 'Restore from a backup',
      keywords: ['restore', 'reinstall', 'new pc'],
      to: PAGE,
    },
  ],
});
