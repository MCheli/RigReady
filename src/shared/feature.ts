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
  /**
   * The games it is about, by the id of their game module ("dcs"), for an entry that is only
   * of use with one of them (the binding guide works on DCS's own files). The menu and the
   * command palette offer it only when one of them is found on this PC, as Games offers a
   * game page's card; its route still opens from a link, and the page says what is missing.
   */
  games?: string[];
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

/**
 * A section a feature adds to the setup editor, for a choice of its own that each setup
 * makes for itself, kept with the setup in `extensions[<feature id>]`. The component gets
 * the setup being edited as the prop `profile` and sends the changed setup back with
 * `update:profile`, so the editor's Save, Cancel and "unsaved changes" cover it. It may ask
 * its own feature's IPC what it needs to say (the overlay: whether the setup's game has
 * bindings RigReady can read).
 */
export interface SetupSection {
  title: string;
  /** Loaded when the setup editor opens: `() => import('./renderer/MySetupSection.vue')`. */
  component: AsyncComponentLoader;
  /** Lower comes first among the sections features add. Default 500. */
  order?: number;
}

/**
 * A page of a feature that is about one game or one kind of game ("DCS World", "Racing").
 * It has no entry of its own in the menu: the Games page offers it with a card, and the
 * menu marks Games while it is open. So the menu does not grow when a game gets a page.
 */
export interface GamePage {
  /** Its name, on its card and in the command palette: "DCS World". */
  title: string;
  /** Material Design Icons name. */
  icon: string;
  /** Its route. A route below it belongs to it too ("/configure/dcs/screens"). */
  to: string;
  /** One line on its card: what is set up there. */
  about: string;
  /**
   * The games it is about, by the id of their game module ("dcs", "iracing"). Its card is
   * shown when one of them is found on this PC, so nobody is offered a page about a game
   * they do not have; the page of the game itself (Games, then the game) still leads there.
   */
  games: string[];
  /** Lower comes first, in the 200s of the Games section. */
  order: number;
}

/**
 * The bindings page of one game. The menu has one Bindings entry for all games: it opens
 * the page of the game chosen last, and its game picker lists every page declared here.
 */
export interface BindingsPage {
  /**
   * The game's id, as its game module has it ("dcs", "iracing"). Until a game has been
   * chosen, Bindings opens the page of the game the setup in use is for.
   */
  game: string;
  /** What the picker calls the game: "DCS". The page is "DCS bindings" in the palette. */
  name: string;
  /** Its route. A route below it belongs to it too ("/configure/dcs-bindings/devices"). */
  to: string;
  /** Lower comes first in the picker: 1 to 999. */
  order: number;
}

export interface FeatureManifest {
  id: string;
  /** Entries in the Configure navigation. */
  nav?: NavEntry[];
  /** Pages about a game that are reached from Games instead of an entry of their own. */
  gamePages?: GamePage[];
  /** Bindings pages, one per game, reached from the one Bindings entry and its game picker. */
  bindings?: BindingsPage[];
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
  /**
   * Small controls in the app bar, beside "Find or run", on every screen: a button that
   * opens something of the feature's own (the assistant panel). A control shows itself only
   * when it has something to offer.
   */
  barItems?: Component[];
  /** Check types this feature registers in main, with the label shown in editors. */
  checkTypes?: { type: string; label: string; group: CheckGroup }[];
  remediationTypes?: { type: string; label: string }[];
  /** Sections on the Settings page, below the app's own. */
  settings?: SettingsSection[];
  /** Sections in the setup editor, below the editor's own. */
  setupSections?: SetupSection[];
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

/**
 * The menu's one Bindings entry. It is the shell's own, there as soon as one feature has a
 * bindings page: the route opens the page of the game chosen last (src/renderer/router.ts).
 */
export const BINDINGS_ENTRY: NavEntry = {
  title: 'Bindings',
  icon: 'mdi-controller',
  to: '/configure/bindings',
  order: 300,
  section: 'Controls',
};

/** Who an entry or a page comes from when no feature folder does: the shell itself. */
export const SHELL_FEATURE = 'shell';

const byOrder = <T extends { order: number; to: string }>(a: T, b: T): number =>
  a.order - b.order || a.to.localeCompare(b.to);

/** Every bindings page the features declare, in the picker's order, with its feature. */
export function bindingsPagesOf(
  manifests: FeatureManifest[]
): (BindingsPage & { feature: string })[] {
  return manifests
    .flatMap((m) => (m.bindings ?? []).map((page) => ({ ...page, feature: m.id })))
    .sort(byOrder);
}

/** Every game page the features declare, in the order of their cards, with its feature. */
export function gamePagesOf(manifests: FeatureManifest[]): (GamePage & { feature: string })[] {
  return manifests
    .flatMap((m) => (m.gamePages ?? []).map((page) => ({ ...page, feature: m.id })))
    .sort(byOrder);
}

/**
 * Every entry of the menu with the feature it comes from: the features' own, and the
 * Bindings entry once a feature has a bindings page.
 */
export function navEntriesOf(manifests: FeatureManifest[]): { entry: NavEntry; feature: string }[] {
  const own = manifests.flatMap((m) => (m.nav ?? []).map((entry) => ({ entry, feature: m.id })));
  return bindingsPagesOf(manifests).length > 0
    ? [...own, { entry: BINDINGS_ENTRY, feature: SHELL_FEATURE }]
    : own;
}

/** A page without an entry of its own that stands under one, named and placed like an entry. */
export interface Place {
  entry: NavEntry;
  feature: string;
  /** The route of the menu entry it stands under. */
  under: string;
}

/**
 * One feature's pages that stand under another's entry, each named and placed as an entry
 * of its own would be: a game page in the Games section, a bindings page right after the
 * Bindings entry and before the next one ("DCS bindings").
 */
export function placeEntriesOf(manifest: FeatureManifest): {
  entry: NavEntry;
  kind: 'game' | 'bindings';
}[] {
  const games = (manifest.gamePages ?? []).map((page) => ({
    kind: 'game' as const,
    entry: {
      title: page.title,
      icon: page.icon,
      to: page.to,
      order: page.order,
      section: 'Games' as const,
    },
  }));
  const bindings = (manifest.bindings ?? []).map((page) => ({
    kind: 'bindings' as const,
    entry: {
      title: `${page.name} bindings`,
      icon: BINDINGS_ENTRY.icon,
      to: page.to,
      order: BINDINGS_ENTRY.order + page.order / 1000,
      section: BINDINGS_ENTRY.section,
    },
  }));
  return [...games, ...bindings];
}

/**
 * The pages that have no entry of their own but stand under one: each game page under the
 * first entry of the Games section, each bindings page under Bindings. The menu marks that
 * entry while one is open, and the command palette lists them where their entries used to
 * be, under the same names ("DCS World", "DCS bindings").
 */
export function placesOf(manifests: FeatureManifest[]): Place[] {
  const games = navEntriesOf(manifests)
    .map(({ entry }) => entry)
    .filter((entry) => entry.section === 'Games')
    .sort((a, b) => a.order - b.order)[0];
  return manifests.flatMap((m) =>
    placeEntriesOf(m).flatMap(({ entry, kind }): Place[] => {
      const under = kind === 'game' ? games?.to : BINDINGS_ENTRY.to;
      return under ? [{ entry, feature: m.id, under }] : [];
    })
  );
}

/**
 * The games found on this PC, by the id of their game module: what the shell offers an
 * entry or a page about a game by. Undefined when that could not be told.
 */
export type FoundGames = readonly string[] | undefined;

/**
 * Whether something about these games is offered on this PC: when it is about no game in
 * particular, when one of them is found, or when what is found could not be told (then it is
 * offered, and its page says what it finds).
 */
export function offeredFor(games: readonly string[] | undefined, found: FoundGames): boolean {
  return !games?.length || found === undefined || games.some((id) => found.includes(id));
}

/**
 * The games a page of the app is about, from the entry or the page it lies in: a menu
 * entry's `games`, a game page's `games`, a bindings page's game. The nearest one decides,
 * so the Wheel entry inside the Racing page's address is about no game. Undefined for a page
 * about no game in particular. A query or a hash in the address is not part of the path.
 */
export function gamesOfRoute(
  manifests: FeatureManifest[],
  address: string
): readonly string[] | undefined {
  const path = address.split(/[?#]/)[0]!;
  const owners: { to: string; games: readonly string[] | undefined }[] = [
    ...navEntriesOf(manifests).map(({ entry }) => ({ to: entry.to, games: entry.games })),
    ...gamePagesOf(manifests).map((page) => ({ to: page.to, games: page.games })),
    ...bindingsPagesOf(manifests).map((page) => ({ to: page.to, games: [page.game] })),
  ];
  let nearest: (typeof owners)[number] | undefined;
  for (const owner of owners) {
    if (path !== owner.to && !path.startsWith(`${owner.to}/`)) continue;
    if (nearest === undefined || owner.to.length > nearest.to.length) nearest = owner;
  }
  return nearest?.games?.length ? nearest.games : undefined;
}

/**
 * The Configure navigation: every entry by section, in order. With `found`, an entry about
 * a game (`games`) is left out while none of its games is found on this PC.
 */
export function navSectionsOf(
  manifests: FeatureManifest[],
  found?: FoundGames
): { section: NavEntry['section']; entries: NavEntry[] }[] {
  const entries = navEntriesOf(manifests)
    .map(({ entry }) => entry)
    .filter((entry) => offeredFor(entry.games, found));
  return SECTION_ORDER.map((section) => ({
    section,
    entries: entries
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
   * parameters of the link again; with changes that are not saved on it, its own address
   * leaves it as it is, and another address asks first (src/renderer/shell/go.ts).
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
   * The id of the game the setup in use is for ("dcs"), when this feature knows. Bindings
   * opens that game's page until the user has chosen one.
   */
  setupGame?: (shell: CommandShell) => Promise<string | undefined>;
  /**
   * The ids of the games found on this PC ("dcs", "iracing"), when this feature knows (the
   * games feature, from the list its Games page shows). The shell offers an entry or a page
   * about a game, in the menu and in the command palette, only when the game is found. A
   * throw means it could not be told: then everything is offered, as before.
   */
  gamesFound?: (shell: CommandShell) => Promise<string[]>;
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
