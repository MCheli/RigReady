import { bind, defineFeatureMain } from '../../core/feature';
import { ok, type Result } from '../../core/result';
import { processesContract, type OwnAppsView } from './contract';
import { OwnApps, type OwnAppsRead } from './core/ownApps';
import {
  createLaunchRemediation,
  createProcessRunningCheck,
  pathResolver,
  createProcessCapture,
  SessionStarts,
} from './core/processCheck';

export default defineFeatureMain({
  id: 'processes',
  setup(ctx) {
    // Shared by the check and its fix: Stand down closes what Make ready started.
    const session = new SessionStarts();
    const resolve = pathResolver(ctx.games);
    // The apps the user asked to be offered in every new setup ("Always offer this app").
    const own = new OwnApps(ctx.ports.files, ctx.ports.folders.dataRoot());
    const windowsDir = (): string => ctx.ports.folders.windows();
    ctx.checks.registerCheck(createProcessRunningCheck(session, resolve));
    ctx.checks.registerRemediation(createLaunchRemediation(session, resolve));
    ctx.checks.registerCapture(createProcessCapture(ctx.games, own));
    const view = (read: Result<OwnAppsRead>): Result<OwnAppsView> =>
      read.ok ? ok({ file: own.file, ...read.value }) : read;
    return [
      bind(processesContract, {
        ownApps: async () => view(await own.read(windowsDir())),
        changeOwnApp: async ({ name, title, closeAtStandDown }) =>
          view(
            await own.change(
              name,
              {
                ...(title !== undefined ? { title } : {}),
                ...(closeAtStandDown !== undefined ? { closeAtStandDown } : {}),
              },
              windowsDir()
            )
          ),
        forgetOwnApp: async ({ name }) => view(await own.remove(name, windowsDir())),
      }),
    ];
  },
});
