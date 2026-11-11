import { BackupFileStore } from '../../core/files/fileStore';
import type { Logger } from '../../core/logger';
import type {
  AppWindow,
  Clipboard,
  Dialogs,
  Hotkeys,
  LoginItem,
  Notifications,
  Overlays,
  Ports,
  Render,
  Secrets,
  Shortcuts,
  Taskbar,
  UpdateFeed,
} from '../../core/ports';
import { NodeHttp, NodeRawFs, NodeShell, headlessPorts, systemClock } from '../node';
import { WindowsAudioProvider } from './audio';
import { WindowsDeviceProvider } from './devices';
import { WindowsDisplayProvider } from './displays';
import { launchHidden } from './hiddenLaunch';
import { SidecarInputProvider, locateSidecar } from './input';
import { WindowsKnownFolders } from './knownFolders';
import { WindowsProcessProvider } from './processes';
import { WindowsRegistry } from './registry';
import { WindowsServiceProvider } from './services';
import { SidecarVirtualPads, locatePadHelper } from './virtualPads';

/** The ports only the Electron app can provide (src/platform/electron). */
export interface AppPorts {
  secrets: Secrets;
  dialogs: Dialogs;
  render: Render;
  notifications: Notifications;
  clipboard: Clipboard;
  loginItem: LoginItem;
  overlays: Overlays;
  window: AppWindow;
  updates: UpdateFeed;
  shortcuts: Shortcuts;
  taskbar: Taskbar;
  hotkeys: Hotkeys;
}

export interface WindowsPlatformOptions {
  log: Logger;
  /** process.resourcesPath when packaged. */
  resourcesPath?: string;
  /** Repository root in development. */
  projectRoot: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Builds the Electron-backed ports once the data root is known. Without it (scripts,
   * rig smoke tests) those ports report that they are unavailable.
   */
  app?: (dataRoot: string) => AppPorts;
}

/** The real machine. */
export function createWindowsPorts(options: WindowsPlatformOptions): Ports {
  const registry = new WindowsRegistry();
  const folders = new WindowsKnownFolders(options.env ?? process.env, registry);
  const shell = new NodeShell(launchHidden);
  const location: { resourcesPath?: string; projectRoot: string } = {
    projectRoot: options.projectRoot,
  };
  if (options.resourcesPath) location.resourcesPath = options.resourcesPath;
  return {
    devices: new WindowsDeviceProvider(),
    input: new SidecarInputProvider(() => locateSidecar(location), options.log.child('input')),
    displays: new WindowsDisplayProvider(),
    processes: new WindowsProcessProvider(shell),
    services: new WindowsServiceProvider(),
    audio: new WindowsAudioProvider(),
    registry,
    files: new BackupFileStore(new NodeRawFs(), folders.dataRoot(), systemClock),
    folders,
    shell,
    clock: systemClock,
    http: new NodeHttp(),
    pads: new SidecarVirtualPads(
      () => locatePadHelper(location),
      () => {
        const reader = locateSidecar(location);
        return reader.ok ? reader.value.python : undefined;
      },
      options.log.child('pads')
    ),
    ...(options.app ? options.app(folders.dataRoot()) : headlessPorts),
  };
}
