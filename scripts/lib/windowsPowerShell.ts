/**
 * Starting Windows PowerShell (powershell.exe, version 5.1) from a test or a script.
 *
 * A process started from PowerShell 7 inherits a PSModulePath that names PowerShell 7's own
 * modules first. Windows PowerShell started with it finds those first and cannot load them:
 * "The 'Get-AuthenticodeSignature' command was found in the module
 * 'Microsoft.PowerShell.Security', but the module could not be loaded". GitHub's Windows
 * runners start every step from PowerShell 7, so there it always happens. Without the variable
 * Windows PowerShell uses its own default, as on a desk PC. electron-updater starts it the same
 * way, with `set "PSModulePath="` before powershell.exe in its command line.
 */

const isModulePath = (name: string): boolean => name.toLowerCase() === 'psmodulepath';

/** A copy of `env` without PSModulePath (in any case), for starting powershell.exe. */
export function windowsPowerShellEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !isModulePath(name)));
}

/** Removes PSModulePath (in any case) from `env`, so every program this process starts goes without it. */
export function forgetPsModulePath(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of Object.keys(env)) if (isModulePath(name)) delete env[name];
}
