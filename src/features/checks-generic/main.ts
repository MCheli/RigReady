import { defineFeatureMain } from '../../core/feature';
import { createFileCapture, createFileContentCheck, createFileExistsCheck } from './core/fileCheck';
import { createGameUpdatedCapture, createGameUpdatedCheck } from './core/gameUpdated';
import { instructionsRemediation } from './core/instructions';
import { createRestoreRemediation, SavedCopies } from './core/restoreFile';
import { createScriptCheck, createScriptRemediation } from './core/script';
import { serviceCapture, serviceRunningCheck } from './core/serviceCheck';

/**
 * Check and fix types that do not belong to one piece of hardware: Windows services,
 * config files, scripts, game updates; run a script, show instructions, restore a file.
 * No screens of its own: Fly, Make ready and the setup editor pick them up through the registry.
 */
export default defineFeatureMain({
  id: 'checks-generic',
  setup(ctx) {
    const copies = new SavedCopies(ctx.ports.files, ctx.ports.folders.dataRoot());
    ctx.checks.registerCheck(serviceRunningCheck);
    ctx.checks.registerCheck(createFileExistsCheck(ctx.games));
    ctx.checks.registerCheck(createFileContentCheck(ctx.games));
    ctx.checks.registerCheck(createScriptCheck(ctx.games));
    ctx.checks.registerCheck(createGameUpdatedCheck(ctx.games));
    ctx.checks.registerRemediation(createScriptRemediation(ctx.games));
    ctx.checks.registerRemediation(instructionsRemediation);
    ctx.checks.registerRemediation(createRestoreRemediation(copies, ctx.games));
    ctx.checks.registerCapture(serviceCapture);
    ctx.checks.registerCapture(createFileCapture(ctx.games));
    ctx.checks.registerCapture(createGameUpdatedCapture(ctx.games));
  },
});
