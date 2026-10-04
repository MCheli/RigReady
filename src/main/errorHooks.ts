import { app, dialog, type BrowserWindow } from 'electron';
import { appErrors } from '../core/errorCenter';
import type { Logger } from '../core/logger';

/**
 * Nothing unexpected goes unseen: an exception or rejection that reaches the top of the
 * main process, a window whose renderer died and a helper process that crashed are
 * reported to the error center, which logs them and shows the notice in the window.
 * The app keeps running.
 */

/** Installed before anything else runs. */
export function installProcessErrorHooks(): void {
  process.on('uncaughtException', (error) => {
    console.error('uncaughtException', error);
    appErrors.report('main', error);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('unhandledRejection', reason);
    appErrors.report('main', reason);
  });
  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || details.reason === 'killed') return;
    appErrors.report(
      'process',
      `A helper process stopped unexpectedly (${details.type}${details.name ? ` ${details.name}` : ''}: ${details.reason}).`,
      `exit code ${details.exitCode}`
    );
  });
}

/** Once the log exists: everything reported so far and from now on is written to it. */
export function logReportedErrors(log: Logger): void {
  const write = (report: { source: string; message: string; detail?: string }): void =>
    log.error(`unexpected error in ${report.source}: ${report.message}`, report.detail);
  for (const report of appErrors.all()) write(report);
  appErrors.subscribe(write);
}

/** A window whose page crashed is loaded again, so the user gets the app back with a notice. */
export function watchWindow(window: BrowserWindow, log: Logger): void {
  const reloads: number[] = [];
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    appErrors.report(
      'window',
      `The RigReady window stopped working (${details.reason}) and was loaded again.`,
      `exit code ${details.exitCode}`
    );
    const now = Date.now();
    // A page that dies every time it loads is not reloaded for ever.
    while (reloads.length > 0 && now - reloads[0]! > 60_000) reloads.shift();
    if (reloads.length >= 3 || window.isDestroyed()) {
      log.error('the window keeps crashing; not loading it again');
      return;
    }
    reloads.push(now);
    window.webContents.reload();
  });
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    appErrors.report('window', error, `preload ${preloadPath}`);
  });
  window.on('unresponsive', () => log.warn('the window is not responding'));
  window.on('responsive', () => log.info('the window is responding again'));
}

/**
 * RigReady could not start at all. There is no window to show a notice in, so Windows
 * shows a message box; scenario and test runs only log (a message box would block them).
 */
export function reportStartFailure(error: unknown, log: Logger | undefined): void {
  console.error('RigReady failed to start', error);
  log?.error('RigReady failed to start', error);
  if (process.env['RIGREADY_SCENARIO'] || process.argv.includes('--diagnose')) return;
  const text = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox(
    'RigReady could not start',
    `${text}\n\nThe log in the RigReady data folder (logs\\rigready.log) has the details.`
  );
}
