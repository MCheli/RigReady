import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { GameRegistry } from '../../../core/games';
import type { Backup, Finding, Inventory, PluginSummary, StreamDeckStatus } from './model';

/**
 * Plain-language findings about the Stream Deck setup: actions whose plugin is missing,
 * plugins whose own dependency (a DCS export script) is missing, and backup hygiene.
 */

export const DCS_SETUP_ROUTE = { label: 'Open DCS setup', to: '/configure/dcs-setup' };

const count = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

const uses = (n: number): string => (n === 1 ? 'uses' : 'use');

function usedIn(plugin: PluginSummary): string {
  const shown = plugin.profiles.slice(0, 4).map((p) => `${p.name} (${p.actions})`);
  const more = plugin.profiles.length - shown.length;
  return shown.join(', ') + (more > 0 ? ` and ${count(more, 'more profile')}` : '');
}

/** One line of Export.lua that is not a comment and loads the given script. */
function loads(exportLua: string, script: RegExp): boolean {
  return exportLua
    .split(/\r?\n/)
    .some((line) => !/^\s*--/.test(line) && script.test(line.replace(/--.*$/, '')));
}

const EXPORT_SCRIPT = /DCS-ExportScript[\\/]+ExportScript\.lua/i;
const DCS_BIOS = /DCS-BIOS[\\/]+(?:BIOS|dcs-bios)\.lua/i;

interface DcsExportState {
  /** Saved Games\DCS (or DCS.openbeta) folders that exist. */
  folders: { label: string; path: string }[];
  exportLua?: string;
  exportLuaPath?: string;
  exportScriptInstalled: boolean;
  ikarusPort?: number;
}

async function readDcsExport(ctx: CheckContext, games: GameRegistry): Promise<DcsExportState> {
  const dcs = games.get('dcs');
  const locations = dcs ? await dcs.configLocations(ctx) : undefined;
  const folders = locations?.ok ? locations.value : [];
  const first = folders[0];
  if (!first) return { folders: [], exportScriptInstalled: false };
  const scripts = path.join(first.path, 'Scripts');
  const exportLuaPath = path.join(scripts, 'Export.lua');
  const exportLua = await ctx.ports.files.readText(exportLuaPath);
  const exportScriptDir = path.join(scripts, 'DCS-ExportScript');
  const config = await ctx.ports.files.readText(path.join(exportScriptDir, 'Config.lua'));
  const port = config.ok ? /IkarusPort\s*=\s*(\d+)/.exec(config.value)?.[1] : undefined;
  return {
    folders,
    exportLuaPath,
    ...(exportLua.ok ? { exportLua: exportLua.value } : {}),
    exportScriptInstalled: await ctx.ports.files.exists(
      path.join(exportScriptDir, 'ExportScript.lua')
    ),
    ...(port ? { ikarusPort: Number(port) } : {}),
  };
}

/** The DCS Interface plugin listens for DCS-ExportScript on this UDP port by default. */
export const DCS_INTERFACE_PORT = 1725;

function dcsInterfaceFindings(plugin: PluginSummary, dcs: DcsExportState): Finding[] {
  const actions = count(plugin.actions, 'action');
  const base = `${actions} in ${count(plugin.profiles.length, 'profile')} ${uses(plugin.actions)} ${plugin.name}: ${usedIn(plugin)}.`;
  if (dcs.folders.length === 0) {
    return [
      {
        id: 'dcs-interface-no-dcs',
        severity: 'info',
        title: `${plugin.name} is used, but DCS was not found on this PC`,
        detail: `${base} They will do nothing until DCS World is installed and has run once.`,
      },
    ];
  }
  const where = dcs.folders[0]!.label;
  const exportLoaded = dcs.exportLua !== undefined && loads(dcs.exportLua, EXPORT_SCRIPT);
  if (!exportLoaded || !dcs.exportScriptInstalled) {
    const reason =
      dcs.exportLua === undefined
        ? `There is no Export.lua in ${where}\\Scripts, so DCS does not load DCS-ExportScript.`
        : !exportLoaded
          ? `${where}\\Scripts\\Export.lua does not load DCS-ExportScript (the line that does was removed or never added).`
          : `Export.lua loads DCS-ExportScript, but the DCS-ExportScript folder is missing from ${where}\\Scripts.`;
    return [
      {
        id: 'dcs-interface-export',
        severity: 'bad',
        title: `${actions} will stay blank in DCS: DCS-ExportScript is not loaded`,
        detail: `${base} ${plugin.name} gets cockpit data from DCS-ExportScript and sends key presses through it. ${reason} Lamps, displays and dials on these keys will not update, and presses will not reach the cockpit.`,
        fix: `Add DCS-ExportScript back: put the DCS-ExportScript folder in ${where}\\Scripts and add its dofile line to Export.lua. RigReady's DCS setup screen does the Export.lua part for you, with a backup first.`,
        route: DCS_SETUP_ROUTE,
        link: {
          label: 'DCS-ExportScript on GitHub',
          url: 'https://github.com/s-d-a/DCS-ExportScripts',
        },
      },
    ];
  }
  if (dcs.ikarusPort !== undefined && dcs.ikarusPort !== DCS_INTERFACE_PORT) {
    return [
      {
        id: 'dcs-interface-port',
        severity: 'warn',
        title: `DCS-ExportScript sends to port ${dcs.ikarusPort}, ${plugin.name} listens on ${DCS_INTERFACE_PORT}`,
        detail: `${base} DCS-ExportScript's Config.lua sets IkarusPort to ${dcs.ikarusPort}. Unless you changed the plugin's port too, the keys will not receive data.`,
        fix: `Set IkarusPort = ${DCS_INTERFACE_PORT} in ${where}\\Scripts\\DCS-ExportScript\\Config.lua, or change the port in the plugin's settings to match.`,
      },
    ];
  }
  return [];
}

function dcsBiosFindings(plugin: PluginSummary, dcs: DcsExportState): Finding[] {
  if (dcs.folders.length === 0 || (dcs.exportLua !== undefined && loads(dcs.exportLua, DCS_BIOS))) {
    return [];
  }
  return [
    {
      id: `dcs-bios-${plugin.id}`,
      severity: 'bad',
      title: `${count(plugin.actions, 'action')} ${plugin.actions === 1 ? 'needs' : 'need'} DCS-BIOS, which DCS does not load`,
      detail: `${plugin.name} talks to DCS through DCS-BIOS, and ${dcs.folders[0]!.label}\\Scripts\\Export.lua does not load it. Used in: ${usedIn(plugin)}.`,
      fix: 'Install DCS-BIOS and make sure Export.lua loads it. RigReady’s DCS setup screen checks the Export.lua lines.',
      route: DCS_SETUP_ROUTE,
    },
  ];
}

/** Plugins that need something outside the Stream Deck app to work. */
const DEPENDENCIES: Record<string, (plugin: PluginSummary, dcs: DcsExportState) => Finding[]> = {
  'com.ctytler.dcs': dcsInterfaceFindings,
  'avionics.madjack.dcs': dcsBiosFindings,
};

export interface HealthInput {
  status: StreamDeckStatus;
  inventory: Inventory;
  backups: Backup[];
  now: Date;
}

export async function findings(
  input: HealthInput,
  ctx: CheckContext,
  games: GameRegistry
): Promise<Finding[]> {
  const { status, inventory, backups } = input;
  const out: Finding[] = [];

  const missing = inventory.plugins.filter((p) => !p.installed && p.actions > 0);
  if (missing.length > 1) {
    const total = missing.reduce((sum, p) => sum + p.actions, 0);
    out.push({
      id: 'missing-plugins',
      severity: 'bad',
      title: `${count(total, 'action')} ${uses(total)} ${count(missing.length, 'plugin')} that ${missing.length === 1 ? 'is' : 'are'} not installed`,
      detail: `Keys that use a missing plugin show a warning sign in the Stream Deck app and do nothing when pressed. Missing: ${missing.map((p) => `${p.name} (${count(p.actions, 'action')})`).join(', ')}.`,
      fix: 'Install the plugins below, then restart the Stream Deck app. Plugins are never part of a Stream Deck backup.',
    });
  }
  for (const plugin of missing) {
    out.push({
      id: `missing-${plugin.id}`,
      severity: 'bad',
      title: `${count(plugin.actions, 'action')} ${uses(plugin.actions)} ${plugin.name}, which is not installed`,
      detail: `Plugin ${plugin.id}. Used in: ${usedIn(plugin)}.`,
      fix: plugin.source
        ? `Install it from ${plugin.source.label}, then restart the Stream Deck app.`
        : 'Install it, then restart the Stream Deck app.',
      ...(plugin.source
        ? { link: { label: `Open ${plugin.source.label}`, url: plugin.source.url } }
        : {}),
    });
  }

  const needsDcs = inventory.plugins.filter(
    (p) => p.installed && p.actions > 0 && DEPENDENCIES[p.id]
  );
  if (needsDcs.length > 0) {
    const dcs = await readDcsExport(ctx, games);
    for (const plugin of needsDcs) out.push(...DEPENDENCIES[plugin.id]!(plugin, dcs));
  }

  for (const problem of inventory.problems) {
    out.push({
      id: `problem-${out.length}`,
      severity: 'warn',
      title: 'A profile file could not be read',
      detail: problem,
    });
  }

  if (status.installed && inventory.profiles.length > 0) {
    const newest = backups.find((b) => b.kind === 'manual');
    if (!newest) {
      out.push({
        id: 'no-backup',
        severity: 'warn',
        title: 'Your Stream Deck profiles are not backed up in RigReady',
        detail: `${count(inventory.profiles.length, 'profile')} with ${count(inventory.totalActions, 'action')} would have to be rebuilt by hand if this PC failed.`,
        fix: 'Make a backup now. It takes a few seconds and works while the Stream Deck app is running.',
      });
    } else {
      const days = Math.floor((input.now.getTime() - Date.parse(newest.createdAt)) / 86_400_000);
      if (days > 30) {
        out.push({
          id: 'old-backup',
          severity: 'info',
          title: `The newest Stream Deck backup is ${count(days, 'day')} old`,
          detail: `Changes made to your profiles since ${newest.createdAt.slice(0, 10)} are not in any backup.`,
          fix: 'Make a fresh backup.',
        });
      }
    }
  }

  const rank = { bad: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
