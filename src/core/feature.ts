import type { z } from 'zod';
import type { ChannelMap, Contract, EventMap, Handlers } from '../shared/ipc';
import type { BackupSourceRegistry } from './backupSources';
import type { CheckRegistry } from './checks/registry';
import type { DisplayLayoutStore } from './displays/layouts';
import type { GameRegistry } from './games';
import type { Logger } from './logger';
import type { Ports } from './ports';
import type { ProfileStore } from './profile/store';
import type { SettingsStore } from './settings';

/** What a feature's main.ts receives. */
export interface MainContext {
  ports: Ports;
  log: Logger;
  checks: CheckRegistry;
  games: GameRegistry;
  profiles: ProfileStore;
  /** App settings (desk layout, retention, timeouts, ...). */
  settings: SettingsStore;
  /** Named monitor layouts. */
  layouts: DisplayLayoutStore;
  /** What features suggest backing up (tools that are not game modules register here). */
  backupSources: BackupSourceRegistry;
  /** Sends an event declared in a contract to the renderer. */
  emit<E extends EventMap, K extends keyof E & string>(
    contract: Contract<ChannelMap, E>,
    event: K,
    payload: z.input<E[K]>
  ): void;
}

export interface IpcBinding {
  contract: Contract;
  handlers: Record<string, (input: never) => Promise<unknown>>;
}

/** Pairs a contract with its handlers; the compiler checks every channel is handled. */
export function bind<C extends ChannelMap, E extends EventMap>(
  contract: Contract<C, E>,
  handlers: Handlers<C>
): IpcBinding {
  return {
    contract: contract as unknown as Contract,
    handlers: handlers as IpcBinding['handlers'],
  };
}

export interface FeatureMain {
  id: string;
  /**
   * Called once at startup. Register check, remediation and capture types on
   * ctx.checks, and return the feature's IPC bindings.
   */
  setup(ctx: MainContext): IpcBinding[] | void;
  /** Called when the app is quitting. */
  dispose?(): Promise<void> | void;
}

export function defineFeatureMain(feature: FeatureMain): FeatureMain {
  return feature;
}
