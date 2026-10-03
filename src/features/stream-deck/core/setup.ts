import type { Backup, Finding, Inventory, PluginSummary, StreamDeckStatus } from './model';

/**
 * The guided "new PC" checklist. Every step's state is read from the PC, so the page can
 * be left and resumed at any time. Pure: the renderer passes in the overview.
 */

export interface SetupStep {
  id: 'install' | 'connect' | 'profiles' | 'plugins' | 'dcs' | 'start' | 'backup';
  title: string;
  done: boolean;
  /** What is true now, in a few words. */
  state: string;
}

export interface SetupInput {
  status: StreamDeckStatus;
  inventory: Inventory;
  findings: Finding[];
  backups: Backup[];
}

export interface ExpectedPlugin {
  pluginId: string;
  name: string;
  actions: number;
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

const DCS_PLUGINS = new Set(['com.ctytler.dcs', 'avionics.madjack.dcs']);

export function missingPlugins(input: SetupInput): PluginSummary[] {
  return input.inventory.plugins.filter((p) => !p.installed && p.actions > 0);
}

/** Before the profiles are back: what the newest backup's profiles need that this PC lacks. */
export function expectedPlugins(input: SetupInput): ExpectedPlugin[] {
  const backup = input.backups[0];
  if (!backup || input.inventory.profiles.length > 0) return [];
  const installed = new Set(input.inventory.plugins.filter((p) => p.installed).map((p) => p.id));
  const names = new Map(backup.plugins.map((p) => [p.id, p.name]));
  return backup.pluginsUsed
    .filter((u) => !installed.has(u.pluginId))
    .map((u) => ({
      pluginId: u.pluginId,
      actions: u.actions,
      name: u.name ?? names.get(u.pluginId) ?? u.pluginId,
    }));
}

export function dcsFindings(input: SetupInput): Finding[] {
  return input.findings.filter((f) => f.id.startsWith('dcs-'));
}

export function setupSteps(input: SetupInput): SetupStep[] {
  const { status, inventory, backups } = input;
  const profiles = inventory.profiles.length;
  const missing = missingPlugins(input);
  const expected = expectedPlugins(input);
  const dcs = dcsFindings(input);
  const backedUp = backups.some((b) => b.kind === 'manual');
  const steps: SetupStep[] = [
    {
      id: 'install',
      title: 'Install the Stream Deck app',
      done: status.installed,
      state: status.installed
        ? `Installed${status.version ? `, version ${status.version.split('.').slice(0, 3).join('.')}` : ''}`
        : 'Not installed',
    },
    {
      id: 'connect',
      title: 'Connect your Stream Deck',
      done: status.devices.length > 0,
      state: status.devices.length
        ? `${status.devices.map((d) => d.name).join(', ')} connected`
        : 'No Stream Deck connected',
    },
    {
      id: 'profiles',
      title: 'Bring your profiles back',
      done: profiles > 0,
      state: profiles ? `${plural(profiles, 'profile')} on this PC` : 'No profiles yet',
    },
    {
      id: 'plugins',
      title: 'Install the plugins your profiles use',
      done: profiles > 0 && missing.length === 0,
      state:
        profiles === 0
          ? expected.length
            ? `Your backup needs ${plural(expected.length, 'plugin')}`
            : 'Known once your profiles are back'
          : missing.length
            ? `${plural(missing.length, 'plugin')} missing`
            : 'Every plugin is installed',
    },
  ];
  if (inventory.plugins.some((p) => DCS_PLUGINS.has(p.id) && p.actions > 0)) {
    steps.push({
      id: 'dcs',
      title: 'Let DCS talk to your Stream Deck',
      done: dcs.length === 0,
      state: dcs.length ? 'DCS is not set up for your DCS keys' : 'DCS is set up',
    });
  }
  steps.push(
    {
      id: 'start',
      title: 'Start Stream Deck',
      done: status.running,
      state: status.running ? 'Running' : 'Not running',
    },
    {
      id: 'backup',
      title: 'Back up this PC’s setup',
      done: backedUp,
      state: backedUp ? 'Backed up' : 'No backup made on this PC yet',
    }
  );
  return steps;
}
