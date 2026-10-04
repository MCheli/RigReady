import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { streamDeckContract } from './contract';
import { startApp } from './core/app';
import { StreamDeckBackups } from './core/backups';
import { streamDeckBackupSource } from './core/backupSource';
import {
  connectedCheck,
  createStartRemediation,
  runningCheck,
  streamDeckCapture,
} from './core/checks';
import { overview } from './core/overview';

export default defineFeatureMain({
  id: 'stream-deck',
  setup(ctx) {
    ctx.checks.registerCheck(runningCheck);
    ctx.checks.registerCheck(connectedCheck);
    ctx.checks.registerRemediation(createStartRemediation());
    ctx.checks.registerCapture(streamDeckCapture);
    ctx.backupSources.register(streamDeckBackupSource);

    const backups = new StreamDeckBackups(ctx.ports, {
      async maxBytes() {
        const settings = await ctx.settings.get();
        return (settings.ok ? settings.value.importMaxMegabytes : 200) * 1024 * 1024;
      },
    });
    const checkCtx = { ports: ctx.ports, log: ctx.log };

    return [
      bind(streamDeckContract, {
        overview: () => overview(checkCtx, ctx.games, backups),
        createBackup: ({ name, includePlugins }) =>
          backups.create({ ...(name ? { name } : {}), includePlugins }),
        renameBackup: ({ id, name }) => backups.rename(id, name),
        deleteBackup: async ({ id }) => {
          const removed = await backups.remove(id);
          return removed.ok ? ok(null) : removed;
        },
        exportBackup: async ({ id }) => {
          const exported = await backups.exportTo(id);
          return exported.ok ? ok({ path: exported.value }) : exported;
        },
        importFile: async () => {
          const imported = await backups.importFile();
          return imported.ok ? ok({ backup: imported.value }) : imported;
        },
        importElgato: ({ fileName }) => backups.importElgato(fileName),
        previewRestore: ({ id }) => backups.preview(id),
        restore: ({ id, ...options }) => backups.restore(id, options),
        verifyAppRestore: ({ id }) => backups.verifyAppRestore(id),
        undoRestore: async ({ groupId, force }) => {
          const undone = await backups.undoRestore(groupId, { force });
          return undone.ok ? ok(null) : undone;
        },
        startApp: async () => {
          const started = await startApp(ctx.ports);
          return started.ok ? ok({ message: started.value }) : started;
        },
      }),
    ];
  },
});
