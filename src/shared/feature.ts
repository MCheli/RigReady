import type { AsyncComponentLoader, Component } from 'vue';
import type { RouteRecordRaw } from 'vue-router';
import type { CheckGroup } from '../core/profile/schema';
import type { RigError } from '../core/result';
import type { ChannelMap, Contract, EventMap, createClient } from './ipc';
import type { GameKind } from './models';

/** Renderer-side description of a feature: src/features/<name>/index.ts default-exports one. */

export interface NavEntry {
  title: string;
  /** Material Design Icons name, e.g. "mdi-monitor". */
  icon: string;
  /** Route path, e.g. "/configure/displays". */
  to: string;
  /** Lower comes first. Setups 100s, Games 200s, Controls 300s, Hardware 400s, RigReady 900s. */
  order: number;
  /**
   * Setups: what you fly or race with, and keeping it safe (setups, backups, sharing).
   * Games: the games found on this PC and what each needs set up.
   * Controls: what the buttons do (bindings, the binding guide, cheat sheets).
   * Hardware: the devices, monitors, audio and helper tools of the rig.
   * RigReady: the app itself (settings, the record of changes, diagnostics).
   */
  section: 'Setups' | 'Games' | 'Controls' | 'Hardware' | 'RigReady';
}

/**
 * A section a feature adds to the Settings page for a setting of its own. The component
 * reads and stores the setting through the feature's own IPC; Settings only gives it a
 * titled panel.
 */
export interface SettingsSection {
  title: string;
  /** Loaded when the Settings page opens: `() => import('./renderer/MySettings.vue')`. */
  component: AsyncComponentLoader;
  /** Lower comes first among the sections features add. Default 500. */
  order?: number;
}

export interface FeatureManifest {
  id: string;
  /** Entries in the Configure navigation. */
  nav?: NavEntry[];
  /**
   * Routes. Paths under /configure render inside the Configure layout; a route with
   * meta.mode === 'fly' renders as the Play screen.
   */
  routes?: RouteRecordRaw[];
  /**
   * Components mounted once at the app root, on every screen: prompts that must be
   * able to appear anywhere (e.g. "keep this monitor layout?").
   */
  overlays?: Component[];
  /** Check types this feature registers in main, with the label shown in editors. */
  checkTypes?: { type: string; label: string; group: CheckGroup }[];
  remediationTypes?: { type: string; label: string }[];
  /** Sections on the Settings page, below the app's own. */
  settings?: SettingsSection[];
}

export function defineFeature(manifest: FeatureManifest): FeatureManifest {
  return manifest;
}

/**
 * What the two modes of the app are called on screen: one table for the shell and for any
 * feature that names a mode in its copy, so the word is the same everywhere. "Play" reads
 * the same to someone who flies and to someone who only races. The names inside the
 * program are not these: the mode a route sets with meta.mode is still 'fly', and so are
 * the folder, the routes, the channels and the test ids.
 */
export const MODE_NAMES = { fly: 'Play', configure: 'Configure' } as const;

/**
 * The manifests of a set of discovered modules (what import.meta.glob over every feature
 * folder's index.ts returns), in a stable order. This is the whole registry: a feature is
 * its folder.
 */
export function collectManifests(
  modules: Record<string, { default?: FeatureManifest }>
): FeatureManifest[] {
  return Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, module]) => {
      if (!module.default?.id) throw new Error(`${file} must default-export defineFeature({...})`);
      return module.default;
    });
}

const SECTION_ORDER: NavEntry['section'][] = [
  'Setups',
  'Games',
  'Controls',
  'Hardware',
  'RigReady',
];

/** The Configure navigation: every feature's entries by section, in order. */
export function navSectionsOf(
  manifests: FeatureManifest[]
): { section: NavEntry['section']; entries: NavEntry[] }[] {
  return SECTION_ORDER.map((section) => ({
    section,
    entries: manifests
      .flatMap((m) => m.nav ?? [])
      .filter((entry) => entry.section === section)
      .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
  })).filter((group) => group.entries.length > 0);
}

/**
 * Commands: what a feature offers the command palette (Ctrl+K). A feature folder that has
 * a commands.ts default-exports defineCommands({...}); it is found by glob like the
 * manifest, so no shared file lists it.
 *
 *   export default defineCommands({
 *     feature: 'backup',
 *     commands: [
 *       { id: 'backup.now', title: 'Back up now', icon: 'mdi-backup-restore',
 *         async run(shell) {
 *           const done = await shell.client(backupContract).backUp({ scope: { kind: 'full' } });
 *           return done.ok ? { tone: 'ok', text: '...' } : commandFailed(done.error);
 *         } },
 *     ],
 *   });
 *
 * A command either opens a page (`to`) or does something (`run`) through the feature's own
 * IPC, and then says what really happened: the outcome is shown as a toast.
 */

/** What a command reports when it is done. Never "done" for something that did not happen. */
export interface CommandOutcome {
  /**
   * ok: it happened. warn: it happened in part, or the user has to act. bad: it did not
   * happen. info: something to know that is not a status.
   */
  tone: 'ok' | 'warn' | 'bad' | 'info';
  /** One line: what happened, in the words of the feature's own answer. */
  text: string;
  /** A second line: what failed, what is still missing. */
  detail?: string;
  /** Where to look next: the words on the button and the route it opens. */
  action?: { label: string; to: string };
}

/** The typed client of a contract, as `useClient` gives a page. */
export type FeatureClient<C extends ChannelMap, E extends EventMap> = ReturnType<
  typeof createClient<C, E>
>;

/** What the app shell hands a command. */
export interface CommandShell {
  client<C extends ChannelMap, E extends EventMap>(contract: Contract<C, E>): FeatureClient<C, E>;
  /**
   * Opens a route of the app. A page that is already open is opened afresh, so it reads the
   * parameters of the link again.
   */
  go(to: string): Promise<void>;
  /** The route shown now, e.g. "/configure/displays". */
  route(): string;
  /** Tells every screen that shows machine state to refresh: call it after changing the machine. */
  machineChanged(): void;
  /** One line shown while a command that takes time is still running ("Backing up…"). */
  progress(text: string): void;
}

export interface PaletteCommand {
  /** "<feature>.<name>", unique. Recently used commands are remembered by it. */
  id: string;
  /** What it is called: "Make ready", "Input tester". */
  title: string;
  /** A muted line beside the title: what it acts on ("DCS F/A-18C") or where it is. */
  hint?: string;
  /** Material Design Icons name. */
  icon?: string;
  /** The heading it is listed under. Default: the feature's navigation title. */
  group?: string;
  /** More words it is found by. */
  keywords?: string[];
  /** A page to open: a route, with its query when there is one. */
  to?: string;
  /** Something to do. Resolves with what happened; nothing to say resolves with nothing. */
  run?: (shell: CommandShell) => Promise<CommandOutcome | void>;
}

export interface FeatureCommands {
  /** The feature folder's name. */
  feature: string;
  /** Commands that are always there. */
  commands?: PaletteCommand[];
  /**
   * Commands that depend on the machine or on data: one per setup, saved layout or
   * aircraft. Asked each time the palette opens. A throw leaves them out, and the palette
   * says that this feature's commands could not be listed.
   */
  list?: (shell: CommandShell) => Promise<PaletteCommand[]>;
  /**
   * The kind of game the setup in use is for, when this feature knows. The shell follows it
   * with a quiet accent; nothing depends on it.
   */
  setupKind?: (shell: CommandShell) => Promise<GameKind | undefined>;
  /**
   * Calls `changed` whenever the setup in use may have become another one, so the shell
   * asks `setupKind` again. Returns the function that stops it.
   */
  onSetupChanged?: (shell: CommandShell, changed: () => void) => () => void;
}

export function defineCommands(commands: FeatureCommands): FeatureCommands {
  return commands;
}

/** The outcome of a command whose IPC call came back with an error result. */
export function commandFailed(error: RigError, action?: CommandOutcome['action']): CommandOutcome {
  return {
    tone: 'bad',
    text: error.message,
    ...(error.detail ? { detail: error.detail } : {}),
    ...(action ? { action } : {}),
  };
}

/** Why a command cannot be offered, or undefined when it is sound. */
export function commandProblem(feature: string, command: PaletteCommand): string | undefined {
  if (!command.id.startsWith(`${feature}.`)) return `its id must start with "${feature}."`;
  if (command.title.trim() === '') return 'it has no title';
  const acts = command.run !== undefined;
  const opens = command.to !== undefined;
  // A command that does nothing would be a stub; one that does both has no single outcome.
  if (acts === opens) return 'it must either open a page (to) or do something (run)';
  if (command.to !== undefined && !command.to.startsWith('/')) {
    return 'the page it opens must be an in-app route';
  }
  return undefined;
}

/**
 * The command modules of a set of discovered files (what import.meta.glob over every
 * feature folder's commands.ts returns), in a stable order. A module that does not
 * default-export defineCommands, names another feature than its folder, or holds a command
 * that does nothing is refused with an error that names the file, like a broken manifest.
 */
export function collectCommands(
  modules: Record<string, { default?: FeatureCommands }>
): FeatureCommands[] {
  const seen = new Set<string>();
  return Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, module]) => {
      const contributed = module.default;
      if (!contributed?.feature) {
        throw new Error(`${file} must default-export defineCommands({...})`);
      }
      const folder = /([^/\\]+)[/\\]commands\.ts$/.exec(file)?.[1];
      if (folder !== undefined && folder !== contributed.feature) {
        throw new Error(`${file} names the feature "${contributed.feature}", not its folder`);
      }
      for (const command of contributed.commands ?? []) {
        const problem = commandProblem(contributed.feature, command);
        if (problem) throw new Error(`${file}: command "${command.id}": ${problem}`);
        if (seen.has(command.id)) throw new Error(`Command id used twice: ${command.id}`);
        seen.add(command.id);
      }
      return contributed;
    });
}
