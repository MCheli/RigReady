import { appErrors } from '../../core/errorCenter';
import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import packageJson from '../../../package.json';
import { diagnosticsContract } from './contract';
import {
  copyDiagnostics,
  copyError,
  exportDiagnostics,
  openLogFolder,
  readLog,
  readOverview,
  setLogLevel,
} from './core/diagnostics';

let stopListening: (() => void) | undefined;

export default defineFeatureMain({
  id: 'diagnostics',
  setup(ctx) {
    const options = { appVersion: packageJson.version };
    // Whatever reports an unexpected error (the shell's hooks, the window), the notice shows it.
    stopListening = appErrors.subscribe((report) => {
      ctx.emit(diagnosticsContract, 'error', report);
    });
    return [
      bind(diagnosticsContract, {
        overview: () => readOverview(ctx, options),
        log: (input) => readLog(ctx, input?.limit ?? 400),
        setLogLevel: ({ level }) => setLogLevel(ctx, level),
        copy: () => copyDiagnostics(ctx, options),
        openLogFolder: () => openLogFolder(ctx),
        export: () => exportDiagnostics(ctx, options),
        errors: async () => ok(appErrors.unseen()),
        report: async ({ message, detail }) => ok(appErrors.report('window', message, detail)),
        dismissErrors: async (input) => {
          appErrors.dismiss(input?.ids);
          return ok({ remaining: appErrors.unseen().length });
        },
        copyError: ({ id }) => copyError(ctx, id, options),
      }),
    ];
  },
  dispose() {
    stopListening?.();
  },
});
