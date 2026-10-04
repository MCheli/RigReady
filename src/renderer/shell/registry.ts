import type { RouteRecordRaw } from 'vue-router';
import {
  commandProblem,
  MODE_NAMES,
  type CommandShell,
  type FeatureCommands,
  type FeatureManifest,
  type NavEntry,
  type PaletteCommand,
} from '../../shared/feature';

/**
 * What the command palette lists: every page (from the feature manifests, the pages reached
 * from inside other pages included) and every command a feature contributes from its
 * commands.ts. Pure: the manifests and the command modules are its only input, so a new
 * feature folder is in the palette without one edit here.
 */

export interface ListedCommand extends PaletteCommand {
  feature: string;
  /** The heading it is listed under when nothing has been typed. */
  group: string;
  /** Where that heading stands among the others: lower comes first. */
  groupOrder: number;
  /** Where it stands under its heading. */
  order: number;
  /** A page opens; an action does something and reports what happened. */
  kind: 'page' | 'action';
}

/** The heading of the pages. */
export const GO_TO = 'Go to';
const GO_TO_ORDER = 1_000_000;

const SECTIONS: NavEntry['section'][] = ['Setups', 'Games', 'Controls', 'Hardware', 'RigReady'];
const navRank = (entry: NavEntry): number => SECTIONS.indexOf(entry.section) * 10_000 + entry.order;

/** "assetto-corsa" -> "Assetto corsa". */
export function humanize(segment: string): string {
  const words = segment.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface FlatRoute {
  path: string;
  title?: string;
  mode?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** Every route a link can open as it is: children resolved, optional parameters left out. */
function flatten(routes: RouteRecordRaw[], parent = ''): FlatRoute[] {
  const out: FlatRoute[] = [];
  for (const route of routes) {
    const joined = route.path.startsWith('/')
      ? route.path
      : route.path === ''
        ? parent
        : `${parent}/${route.path}`;
    const path = joined.replace(/\/:[^/]+\?/g, '');
    if (!path.includes(':') && !path.includes('*')) {
      const title = text(route.meta?.['title']);
      const mode = text(route.meta?.['mode']);
      out.push({ path, ...(title ? { title } : {}), ...(mode ? { mode } : {}) });
    }
    if (route.children) out.push(...flatten(route.children, joined));
  }
  return out;
}

/**
 * The page the header's switch opens in Play mode, as the palette lists it. The shell names
 * its modes (MODE_NAMES), so the page is called what the switch calls it, whatever its
 * feature calls the route. It is found by the words for what is done there, too.
 */
const PLAY_PAGE = {
  title: MODE_NAMES.fly,
  hint: 'Is the rig ready, fix what is not, launch',
  icon: 'mdi-play-circle-outline',
  keywords: ['fly', 'race', 'ready', 'checklist', 'home'],
};

/** The heading a feature's commands stand under, and where it stands. */
export function areaOf(manifest: FeatureManifest | undefined, feature: string) {
  const first = [...(manifest?.nav ?? [])].sort((a, b) => navRank(a) - navRank(b))[0];
  if (first) return { title: first.title, order: navRank(first), icon: first.icon };
  const titled = flatten(manifest?.routes ?? []).find((r) => r.title);
  // A feature without a navigation entry of its own comes first. Where its pages are those
  // of Play mode, it stands under the name of the mode.
  const title = titled?.mode === 'fly' ? MODE_NAMES.fly : (titled?.title ?? humanize(feature));
  return { title, order: -1, icon: undefined };
}

/**
 * One command per page: the navigation entries under their own names, and every other route
 * under the name of the page it belongs to ("DCS World: Screens") until a feature's
 * commands.ts gives it a better one.
 */
export function pageCommands(manifests: FeatureManifest[]): ListedCommand[] {
  const nav = manifests.flatMap((m) => (m.nav ?? []).map((entry) => ({ entry, feature: m.id })));
  const pages: ListedCommand[] = nav.map(({ entry, feature }) => ({
    id: `page:${entry.to}`,
    feature,
    title: entry.title,
    hint: entry.section,
    icon: entry.icon,
    to: entry.to,
    group: GO_TO,
    groupOrder: GO_TO_ORDER,
    order: navRank(entry) * 100,
    kind: 'page',
  }));
  const known = new Set(pages.map((p) => p.to));
  // The first page of Play mode is the one the switch opens (the router's rule, too).
  let playPage: string | undefined;
  for (const manifest of manifests) {
    let position = 0;
    for (const route of flatten(manifest.routes ?? [])) {
      if (known.has(route.path)) continue;
      known.add(route.path);
      position++;
      // The page it is reached from: the navigation entry with the longest matching route.
      const parent = nav
        .filter(({ entry }) => route.path.startsWith(`${entry.to}/`))
        .sort((a, b) => b.entry.to.length - a.entry.to.length)[0]?.entry;
      const last = route.path.split('/').pop() ?? '';
      const play = route.mode === 'fly';
      if (play) playPage ??= route.path;
      const named =
        route.path === playPage
          ? PLAY_PAGE
          : {
              title:
                route.title ?? (parent ? `${parent.title}: ${humanize(last)}` : humanize(last)),
              // Another page of Play mode says so, as a page of Configure names its own.
              ...(parent ? { hint: parent.title } : play ? { hint: MODE_NAMES.fly } : {}),
              icon: parent?.icon ?? (play ? PLAY_PAGE.icon : 'mdi-arrow-right'),
            };
      pages.push({
        id: `page:${route.path}`,
        feature: manifest.id,
        ...named,
        to: route.path,
        group: GO_TO,
        groupOrder: GO_TO_ORDER,
        order: parent ? navRank(parent) * 100 + position : -100 + position,
        kind: 'page',
      });
    }
  }
  return pages.sort((a, b) => a.order - b.order);
}

/** A feature's command as the palette lists it. */
export function listed(
  command: PaletteCommand,
  feature: string,
  manifest: FeatureManifest | undefined,
  position: number
): ListedCommand {
  const area = areaOf(manifest, feature);
  const opens = command.to !== undefined;
  const group = command.group ?? (opens ? GO_TO : area.title);
  return {
    ...command,
    feature,
    ...(command.icon || !area.icon ? {} : { icon: area.icon }),
    // A page without a hint says which page it belongs to, unless its name already does.
    ...(opens && !command.hint && !command.title.startsWith(area.title)
      ? { hint: area.title }
      : {}),
    group,
    groupOrder: group === GO_TO ? GO_TO_ORDER : area.order,
    order: group === GO_TO ? area.order * 100 + 10 + position : position,
    kind: opens ? 'page' : 'action',
  };
}

/**
 * Pages and the features' fixed commands in one list. A command that opens a route the
 * manifests already gave a page for does not add a second entry: for a page reached from
 * inside another it takes that entry's place (the feature knows what its page is called),
 * and for a navigation entry, which keeps its name, its words become words the entry is
 * found by ("undo" finds Safety).
 */
export function staticCommands(
  manifests: FeatureManifest[],
  modules: FeatureCommands[]
): ListedCommand[] {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const navigation = new Set(manifests.flatMap((m) => (m.nav ?? []).map((entry) => entry.to)));
  const pages = new Map(pageCommands(manifests).map((page) => [page.to, page]));
  const others: ListedCommand[] = [];
  for (const module of modules) {
    (module.commands ?? []).forEach((command, index) => {
      const mine = listed(command, module.feature, byId.get(module.feature), index);
      const page = mine.to !== undefined ? pages.get(mine.to) : undefined;
      if (!page) others.push(mine);
      else if (navigation.has(page.to!)) {
        pages.set(page.to, {
          ...page,
          keywords: [...(page.keywords ?? []), mine.title, ...(mine.keywords ?? [])],
        });
      } else {
        // In the place the route had: right after the page it is reached from.
        pages.set(page.to, mine.group === GO_TO ? { ...mine, order: page.order } : mine);
      }
    });
  }
  return sortCommands([...pages.values(), ...others]);
}

export function sortCommands(commands: ListedCommand[]): ListedCommand[] {
  return [...commands].sort(
    (a, b) => a.groupOrder - b.groupOrder || a.group.localeCompare(b.group) || a.order - b.order
  );
}

export interface Listing {
  feature: string;
  commands: ListedCommand[];
  /** Why this feature's commands could not be listed, when they could not. */
  problem?: string;
}

/**
 * Asks one feature for the commands that depend on the machine or on data. Never throws:
 * a feature that fails is left out, and the reason is kept for the palette to show.
 */
export async function listDynamic(
  module: FeatureCommands,
  manifest: FeatureManifest | undefined,
  shell: CommandShell
): Promise<Listing> {
  if (!module.list) return { feature: module.feature, commands: [] };
  try {
    const found = await module.list(shell);
    const commands: ListedCommand[] = [];
    const seen = new Set<string>();
    let problem: string | undefined;
    found.forEach((command, index) => {
      const wrong =
        commandProblem(module.feature, command) ??
        (seen.has(command.id) ? 'its id is used twice' : undefined);
      if (wrong) {
        problem ??= `"${command.title || command.id}": ${wrong}`;
        return;
      }
      seen.add(command.id);
      // After the feature's fixed commands, in the order the feature gave.
      commands.push(listed(command, module.feature, manifest, 1000 + index));
    });
    return { feature: module.feature, commands, ...(problem ? { problem } : {}) };
  } catch (e) {
    return {
      feature: module.feature,
      commands: [],
      problem: e instanceof Error ? e.message : String(e),
    };
  }
}
