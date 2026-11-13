import { computed, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue';
import type { Router } from 'vue-router';
import type { CommandShell, FeatureCommands, FoundGames } from '../../shared/feature';
import type { GameKind } from '../../shared/models';
import { featureCommands, manifests } from '../features';
import { useClient } from '../ipc';
import { notifyMachineChanged, onMachineChanged } from '../machine';
import { followGamesFound } from './games';
import { goTo } from './go';
import { followSetupKind } from './kind';
import { manualPageOfRoute, openManual } from './manual';
import { parseRecent, remember } from './palette';
import {
  listDynamic,
  offeredHere,
  sortCommands,
  staticCommands,
  type ListedCommand,
  type Listing,
} from './registry';
import { createRunner, type Runner } from './runner';
import { toasts } from './toast';

/**
 * The state of the app shell that more than one of its parts needs: which of its own
 * panels is open, and the commands of the palette.
 */

export const paletteOpen = ref(false);
export const shortcutsOpen = ref(false);
export const aboutOpen = ref(false);

/**
 * For a panel of the shell: when it closes, the focus goes back to what had it when it
 * opened (the button that opened it, or wherever the keyboard was). Call it once, in the
 * panel's setup.
 */
export function returnFocus(open: Ref<boolean>): void {
  let cameFrom: HTMLElement | null = null;
  watch(
    open,
    (now) => {
      if (now) {
        const focused = document.activeElement;
        cameFrom = focused instanceof HTMLElement && focused !== document.body ? focused : null;
        return;
      }
      const target = cameFrom;
      cameFrom = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
    },
    // Before the panel is drawn or removed: what has the focus now is what to go back to.
    { flush: 'sync' }
  );
}

/**
 * Raised to open the page shown now afresh: a command that links to the page already on
 * screen must find it reading the parameters of the link, whether or not the page watches
 * its route. Never over changes that are not saved without asking (go.ts).
 */
export const pageEpoch = ref(0);

/**
 * The kind of game the setup in use is for, when a feature can say (kind.ts). The shell
 * shows it with a quiet accent and the shape of its mark; undefined is the plain accent.
 */
export const rigKind = ref<GameKind>();

/** Starts following it. Called once, when the shell is up; returns the function that stops it. */
export async function followRigKind(router: Router): Promise<() => void> {
  let modules: FeatureCommands[];
  try {
    modules = await featureCommands();
  } catch {
    // A command module that does not load is reported by the palette when it is opened;
    // the accent simply stays the plain one.
    return () => undefined;
  }
  return followSetupKind(
    modules,
    createCommandShell(router),
    (kind) => {
      rigKind.value = kind;
    },
    onMachineChanged
  );
}

/**
 * The games found on this PC (games.ts): the menu and the palette offer an entry or a page
 * about a game only when it is found. Nothing is found until the first answer, so an entry
 * about a game appears rather than flashes away; undefined (could not be told) offers all.
 */
export const gamesFound = ref<FoundGames>([]);
/** The first answer is in: `gamesFound` is what is found, not what is not known yet. */
let gamesFoundKnown = false;

/**
 * The games found on this PC for a decision that cannot wait for the first answer (which
 * page Bindings opens): what is followed once it is known, and `ask` until then.
 */
export const gamesFoundNow = async (ask: () => Promise<FoundGames>): Promise<FoundGames> =>
  gamesFoundKnown ? gamesFound.value : ask();

/** Starts following them. Called once, when the shell is up; returns the function that stops it. */
export async function followFoundGames(router: Router): Promise<() => void> {
  let modules: FeatureCommands[];
  try {
    modules = await featureCommands();
  } catch {
    // A command module that does not load is reported by the palette when it is opened.
    // Nothing can say which games are here, so nothing is held back.
    gamesFound.value = undefined;
    gamesFoundKnown = true;
    return () => undefined;
  }
  return followGamesFound(
    modules,
    createCommandShell(router),
    (found) => {
      gamesFound.value = found;
      gamesFoundKnown = true;
    },
    onMachineChanged
  );
}

/** What a command gets from the shell. */
export function createCommandShell(router: Router): CommandShell {
  return {
    client: (contract) => useClient(contract),
    // The page on screen is opened afresh, unless that would drop changes the user keeps.
    go: (to) =>
      goTo(router, to, () => {
        pageEpoch.value++;
      }),
    route: () => router.currentRoute.value.fullPath,
    machineChanged: () => notifyMachineChanged(),
    // Replaced per run by the runner, which owns the toast the line is shown in.
    progress: () => undefined,
  };
}

const RECENT_KEY = 'rigready.palette.recent';

function readRecent(): string[] {
  try {
    return parseRecent(window.localStorage.getItem(RECENT_KEY));
  } catch {
    // Storage is switched off for this window: the palette works without a memory.
    return [];
  }
}

function writeRecent(ids: string[]): void {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch {
    // Storage is full or switched off: the list still holds for as long as the window is open.
  }
}

/** The shell's own commands: its two panels, and the manual. */
function shellCommands(router: Router): ListedCommand[] {
  const own = (
    id: string,
    title: string,
    icon: string,
    keywords: string[],
    open: Ref<boolean>,
    order: number
  ): ListedCommand => ({
    id: `shell.${id}`,
    feature: 'shell',
    title,
    icon,
    keywords,
    group: 'RigReady',
    groupOrder: 900_000,
    order,
    kind: 'action',
    run: async () => {
      open.value = true;
    },
  });
  return [
    own(
      'shortcuts',
      'Keyboard shortcuts',
      'mdi-keyboard-outline',
      ['keys', 'help'],
      shortcutsOpen,
      1
    ),
    own(
      'about',
      'About RigReady',
      'mdi-information-outline',
      ['version', 'licence', 'license', 'website'],
      aboutOpen,
      2
    ),
    manual('manual', 'Open the manual', ['help', 'docs', 'documentation', 'guide'], 3, () =>
      openManual()
    ),
    manual(
      'manualHere',
      'Open the manual page for this screen',
      ['help', 'docs', 'documentation', 'this page'],
      4,
      () => openManual(manualPageOfRoute(router.currentRoute.value))
    ),
  ];
}

/** A command that opens the manual in the browser. */
function manual(
  id: string,
  title: string,
  keywords: string[],
  order: number,
  open: () => void
): ListedCommand {
  return {
    id: `shell.${id}`,
    feature: 'shell',
    title,
    hint: 'Opens in the browser',
    icon: 'mdi-book-open-page-variant-outline',
    keywords,
    group: 'RigReady',
    groupOrder: 900_000,
    order,
    kind: 'action',
    run: async () => {
      open();
    },
  };
}

export interface PaletteCommands {
  /** Every command to list, headings and order settled. */
  commands: ComputedRef<ListedCommand[]>;
  /** Features whose commands could not be listed, with the reason: shown as they are. */
  problems: ComputedRef<string[]>;
  /** The ids of the commands used last, newest first. */
  recent: Ref<string[]>;
  /** Asks every feature again for the commands that depend on the machine or on data. */
  refresh(): Promise<void>;
  /** Runs a command and remembers it as used. */
  use(command: ListedCommand): Promise<void>;
  /** Whether the command is running now. Reactive. */
  isRunning(id: string): boolean;
}

let shared: PaletteCommands | undefined;

/** The palette's commands, loaded once and kept for the life of the window. */
export function usePaletteCommands(router: Router): PaletteCommands {
  if (shared) return shared;
  const shell = createCommandShell(router);
  const runner: Runner = createRunner(shell, toasts);
  const modules = shallowRef<FeatureCommands[]>([]);
  const loadProblem = ref<string>();
  const listings = shallowRef<Record<string, Listing>>({});
  const recent = ref<string[]>(readRecent());
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const own = shellCommands(router);
  let loaded: Promise<void> | undefined;

  function load(): Promise<void> {
    loaded ??= featureCommands().then(
      (found) => {
        modules.value = found;
      },
      (e: unknown) => {
        loadProblem.value = e instanceof Error ? e.message : String(e);
      }
    );
    return loaded;
  }

  // A page about a game is offered only where the game is found (the binding guide, the
  // DCS World and DCS bindings pages and their tabs on a PC with DCS).
  const commands = computed(() =>
    offeredHere(
      sortCommands([
        ...staticCommands(manifests, modules.value),
        ...Object.values(listings.value).flatMap((listing) => listing.commands),
        ...own,
      ]),
      manifests,
      gamesFound.value
    )
  );
  const problems = computed(() => [
    ...(loadProblem.value ? [`Commands could not be loaded: ${loadProblem.value}`] : []),
    ...Object.values(listings.value)
      .filter((listing) => listing.problem)
      .map(
        (listing) =>
          `${byId.get(listing.feature)?.nav?.[0]?.title ?? listing.feature}: ${listing.problem}`
      ),
  ]);

  shared = {
    commands,
    problems,
    recent,
    async refresh() {
      await load();
      // Each feature fills in as it answers; a slow one holds nobody up.
      await Promise.all(
        modules.value
          .filter((module) => module.list)
          .map(async (module) => {
            const listing = await listDynamic(module, byId.get(module.feature), shell);
            listings.value = { ...listings.value, [module.feature]: listing };
          })
      );
    },
    async use(command) {
      recent.value = remember(recent.value, command.id);
      writeRecent(recent.value);
      await runner.run(command);
    },
    isRunning: (id) => runner.running.value.has(id),
  };
  return shared;
}
