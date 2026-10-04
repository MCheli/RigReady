import type { BackupSource, BackupSuggestion } from '../../../core/backupSources';
import { ok } from '../../../core/result';
import { PROCESS_NAME, streamDeckPaths } from './detect';

/**
 * What the backup page offers for Stream Deck, so its profiles are part of a full
 * backup: the profile folder as it is (the app may be running: the files are only read),
 * the plugin list, and the plugin folders for those who want them.
 */
export const streamDeckBackupSource: BackupSource = {
  id: 'stream-deck',
  label: 'Stream Deck',
  async suggest(ctx) {
    const paths = await streamDeckPaths(ctx.ports);
    const suggestions: BackupSuggestion[] = [
      {
        label: 'Stream Deck profiles',
        path: paths.profilesDir,
        kind: 'folder',
        description: 'Every profile with its pages, actions and icons.',
      },
      {
        label: 'Stream Deck plugin list',
        path: paths.pluginsDir,
        kind: 'folder',
        include: ['*/manifest.json'],
        description:
          'Which plugins are installed and in which version (their manifests), so they can be installed again.',
      },
      {
        label: 'Stream Deck plugins (whole folders)',
        path: paths.pluginsDir,
        kind: 'folder',
        description:
          'The plugins themselves. Large; usually it is enough to install them again from the Marketplace.',
      },
    ];
    return ok(suggestions);
  },
  program: {
    name: 'Stream Deck',
    processes: [PROCESS_NAME],
    why: 'Stream Deck keeps its profiles in memory and writes them when it quits, which would undo the restore.',
    restart: true,
  },
};
