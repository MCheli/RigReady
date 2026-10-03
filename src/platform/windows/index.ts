import { BackupFileStore } from '../../core/files/fileStore';
import type { Logger } from '../../core/logger';
import type { Ports } from '../../core/ports';
import { NodeRawFs, NodeShell, systemClock } from '../node';
import { WindowsAudioProvider } from './audio';
import { WindowsDeviceProvider } from './devices';
import { WindowsDisplayProvider } from './displays';
import { SidecarInputProvider, locateSidecar } from './input';
import { WindowsKnownFolders } from './knownFolders';
import { WindowsProcessProvider } from './processes';

export interface WindowsPlatformOptions {
  log: Logger;
  /** process.resourcesPath when packaged. */
  resourcesPath?: string;
  /** Repository root in development. */
  projectRoot: string;
  env?: NodeJS.ProcessEnv;
}

/** The real machine. */
export function createWindowsPorts(options: WindowsPlatformOptions): Ports {
  const folders = new WindowsKnownFolders(options.env ?? process.env);
  const shell = new NodeShell();
  const location: { resourcesPath?: string; projectRoot: string } = {
    projectRoot: options.projectRoot,
  };
  if (options.resourcesPath) location.resourcesPath = options.resourcesPath;
  return {
    devices: new WindowsDeviceProvider(),
    input: new SidecarInputProvider(() => locateSidecar(location), options.log.child('input')),
    displays: new WindowsDisplayProvider(),
    processes: new WindowsProcessProvider(shell),
    audio: new WindowsAudioProvider(),
    files: new BackupFileStore(new NodeRawFs(), folders.dataRoot(), systemClock),
    folders,
    shell,
    clock: systemClock,
  };
}
