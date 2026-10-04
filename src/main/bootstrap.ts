import { BackupSourceRegistry } from '../core/backupSources';
import { BindingRegistry } from '../core/bindings';
import { CheckRegistry } from '../core/checks/registry';
import { DisplayLayoutStore } from '../core/displays/layouts';
import type { FeatureMain, IpcBinding, MainContext } from '../core/feature';
import { GameRegistry } from '../core/games';
import type { Logger } from '../core/logger';
import { NameRegistry } from '../core/names';
import type { Ports } from '../core/ports';
import { verifiedProcesses } from '../core/processes';
import { ProfileStore } from '../core/profile/store';
import { SettingsStore } from '../core/settings';
import { channelName, eventName } from '../shared/channels';
import { createInvoker, type Envelope } from '../shared/ipc';

/** Feature main modules, discovered at build time. Adding a feature edits no shared file. */
export function discoverFeatures(): FeatureMain[] {
  const modules = import.meta.glob<{ default: FeatureMain }>('../features/*/main.ts', {
    eager: true,
  });
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
}): Wiring {
  const { log } = options;
  // A close is believed only when the process is gone from the list (NFR-006).
  const ports: Ports = { ...options.ports, processes: verifiedProcesses(options.ports.processes) };
  const context: MainContext = {
    ports,
    log,
    checks: new CheckRegistry(),
    games: new GameRegistry(),
    profiles: new ProfileStore(ports.files, ports.folders.dataRoot()),
    settings: new SettingsStore(ports.files, ports.folders.dataRoot(), ports.clock),
    layouts: new DisplayLayoutStore(ports.files, ports.folders.dataRoot(), ports.clock),
    names: new NameRegistry(),
    bindings: new BindingRegistry(),
    backupSources: new BackupSourceRegistry(),
    emit(contract, event, payload) {
      const schema = contract.events[event];
      if (!schema) throw new Error(`Unknown event ${contract.feature}:${event}`);
      options.send(eventName(contract.feature, event), schema.parse(payload));
    },
  };

  const handlers = new Map<string, (rawInput: unknown) => Promise<Envelope>>();
  const seen = new Set<string>();
  for (const feature of options.features) {
    if (seen.has(feature.id)) throw new Error(`Feature id used twice: ${feature.id}`);
    seen.add(feature.id);
    const bindings: IpcBinding[] = feature.setup({ ...context, log: log.child(feature.id) }) ?? [];
    for (const binding of bindings) {
      const invoke = createInvoker(binding.contract, binding.handlers as never, (name, error) =>
        log.error(`ipc ${name}`, error)
      );
      for (const key of Object.keys(binding.contract.channels)) {
        const name = channelName(binding.contract.feature, key);
        if (handlers.has(name)) throw new Error(`IPC channel registered twice: ${name}`);
        handlers.set(name, (rawInput) => invoke(key, rawInput));
      }
    }
  }
  return { handlers, features: options.features, context };
}
