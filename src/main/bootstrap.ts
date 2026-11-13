import { BackupSourceRegistry } from '../core/backupSources';
import { BindingRegistry } from '../core/bindings';
import { CheckRegistry } from '../core/checks/registry';
import { ContractRegistry } from '../core/contracts';
import { DisplayLayoutStore } from '../core/displays/layouts';
import { logFailures } from '../core/failureLog';
import type { FeatureMain, IpcBinding, MainContext } from '../core/feature';
import { GameRegistry } from '../core/games';
import type { Logger } from '../core/logger';
import { McpRegistry } from '../core/mcp';
import { NameRegistry } from '../core/names';
import type { Ports } from '../core/ports';
import { verifiedProcesses } from '../core/processes';
import { ProfileStore } from '../core/profile/store';
import { err } from '../core/result';
import { SettingsStore } from '../core/settings';
import { channelName, eventName } from '../shared/channels';
import { createInvoker, type Envelope } from '../shared/ipc';

/** Feature main modules, discovered at build time. Adding a feature edits no shared file. */
export function discoverFeatures(
  /** What the glob found. Tests pass their own, to add a feature that is not in src/features. */
  modules: Record<string, { default?: FeatureMain }> = import.meta.glob<{ default: FeatureMain }>(
    '../features/*/main.ts',
    { eager: true }
  )
): FeatureMain[] {
  return Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, module]) => {
      if (!module.default?.id)
        throw new Error(`${file} must default-export defineFeatureMain({...})`);
      return module.default;
    });
}

export interface Wiring {
  /** channel name -> handler taking the raw renderer input. */
  handlers: Map<string, (rawInput: unknown) => Promise<Envelope>>;
  features: FeatureMain[];
  context: MainContext;
}

/**
 * Builds the context, runs every feature's setup and collects validated IPC handlers.
 * Free of Electron so it can be exercised in unit tests with fake ports.
 */
export function wireFeatures(options: {
  features: FeatureMain[];
  ports: Ports;
  log: Logger;
  send: (channel: string, payload: unknown) => void;
  /**
   * How `ctx.invoke` reaches a channel. The shell passes the same path the tray and the
   * command line use (so the taskbar and the tray follow what was done); without one, the
   * handlers wired here are called directly.
   */
  invoke?: (channel: string, input: unknown) => Promise<Envelope>;
}): Wiring {
  const { log } = options;
  // A close is believed only when the process is gone from the list (NFR-006).
  const ports: Ports = { ...options.ports, processes: verifiedProcesses(options.ports.processes) };
  const handlers = new Map<string, (rawInput: unknown) => Promise<Envelope>>();
  const contracts = new ContractRegistry();
  const invokeHere = async (channel: string, input: unknown): Promise<Envelope> => {
    const handler = handlers.get(channel);
    if (!handler) return err('ipc.unknown', `Unknown channel ${channel}.`);
    return handler(input);
  };
  const invoke = options.invoke ?? invokeHere;
  const context: MainContext = {
    ports,
    log,
    checks: new CheckRegistry(),
    games: new GameRegistry(),
    profiles: new ProfileStore(ports.files, ports.folders.dataRoot()),
    settings: new SettingsStore(ports.files, ports.folders.dataRoot(), ports.clock),
    layouts: new DisplayLayoutStore(ports.files, ports.folders.dataRoot(), ports.clock),
    names: new NameRegistry(log),
    bindings: new BindingRegistry(),
    backupSources: new BackupSourceRegistry(),
    contracts,
    mcp: new McpRegistry(),
    invoke: (channel, input) => invoke(channel, input),
    emit(contract, event, payload) {
      const schema = contract.events[event];
      if (!schema) throw new Error(`Unknown event ${contract.feature}:${event}`);
      options.send(eventName(contract.feature, event), schema.parse(payload));
    },
  };

  const seen = new Set<string>();
  for (const feature of options.features) {
    if (seen.has(feature.id)) throw new Error(`Feature id used twice: ${feature.id}`);
    seen.add(feature.id);
    const featureLog = log.child(feature.id);
    // Every channel that answers with an error leaves a line under its feature's name: the
    // code and the message, so a support export says what the user was told.
    const bindings: IpcBinding[] = (feature.setup({ ...context, log: featureLog }) ?? []).map(
      (binding) => logFailures(binding, featureLog, ports.clock)
    );
    for (const binding of bindings) {
      contracts.register(binding.contract);
      const invoke = createInvoker(binding.contract, binding.handlers as never, (name, error) =>
        log.error(`ipc ${name}`, error)
      );
      for (const key of Object.keys(binding.contract.channels)) {
        const name = channelName(binding.contract.feature, key);
        if (handlers.has(name)) throw new Error(`IPC channel registered twice: ${name}`);
        handlers.set(name, async (rawInput) => {
          const envelope = await invoke(key, rawInput);
          // Expected failures go back to the screen that asked; the detailed log has them whole.
          if (!envelope.ok) log.debug(`ipc ${name} answered with an error`, envelope.error);
          return envelope;
        });
      }
    }
  }
  return { handlers, features: options.features, context };
}
