import type { z } from 'zod';
import type { ChannelMap, Contract, Envelope, EventMap, Handlers } from '../shared/ipc';
import type { BackupSourceRegistry } from './backupSources';
import type { BindingRegistry } from './bindings';
import type { CheckRegistry } from './checks/registry';
import type { ContractRegistry } from './contracts';
import type { DisplayLayoutStore } from './displays/layouts';
import type { GameRegistry } from './games';
import type { Logger } from './logger';
import type { McpRegistry } from './mcp';
import type { NameRegistry } from './names';
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
  /** The names the owner gave monitors and devices, for every feature to show. */
  names: NameRegistry;
  /** What is bound in each game, for features other than the one that owns the bindings. */
  bindings: BindingRegistry;
  /** What features suggest backing up (tools that are not game modules register here). */
  backupSources: BackupSourceRegistry;
  /** Every wired contract as data (filled while the features are wired; complete after every setup). */
  contracts: ContractRegistry;
  /** What features offer an AI assistant through the MCP server: task-level tools, resources, prompts. */
  mcp: McpRegistry;
  /**
   * Calls any IPC channel of the app, validated, exactly as a window of the app would: the
   * way something that acts for the user from outside the window (the MCP server) does
   * what the Play screen does. Not for one feature to reach into another: that goes
   * through the registries on this context. Usable once every feature's setup has run.
   */
  invoke(channel: string, input?: unknown): Promise<Envelope>;
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
  /**
   * Called once after every feature's setup ran and the shell can take calls: for work
   * that needs the whole app wired (the MCP server starts listening here when it is on).
   * Not awaited by anything the user waits for; report failures through the log.
   */
  start?(): Promise<void> | void;
  /** Called when the app is quitting. */
  dispose?(): Promise<void> | void;
}

export function defineFeatureMain(feature: FeatureMain): FeatureMain {
  return feature;
}
