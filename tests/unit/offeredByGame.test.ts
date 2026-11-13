/**
 * NAV-GAMES-006: an entry or a page about a game is offered where the game is found. A user
 * without DCS does not meet the binding guide in the menu, nor the DCS World and DCS bindings
 * pages in the command palette; a user with DCS meets all of them. Run on the real path: the
 * manifests as the features declare them, the features' real commands.ts, the games feature's
 * `gamesFound` against the wired main side, and the shell's own follower, menu and filter.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { err } from '../../src/core/result';
import { followGamesFound } from '../../src/renderer/shell/games';
import {
  listDynamic,
  offeredHere,
  sortCommands,
  staticCommands,
} from '../../src/renderer/shell/registry';
import {
  collectCommands,
  navSectionsOf,
  type CommandShell,
  type FeatureCommands,
  type FeatureManifest,
  type FoundGames,
} from '../../src/shared/feature';
import { createClient, type Bridge } from '../../src/shared/ipc';
import { repoRoot, wiredApp, type WiredApp } from '../helpers';

const modules = collectCommands(
  import.meta.glob<{ default: FeatureCommands }>('../../src/features/*/commands.ts', {
    eager: true,
  })
);

type Literal = string | number | boolean | Literal[] | { [key: string]: Literal } | undefined;

/** A declaration as written: strings, numbers, lists and objects. A component is left out. */
function literal(node: ts.Expression): Literal {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((e) => literal(e));
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, Literal> = {};
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const value = literal(p.initializer);
      if (value !== undefined) out[p.name.getText()] = value;
    }
    return out;
  }
  return undefined;
}

/**
 * Every feature's manifest as its index.ts declares it, without its components: a manifest
 * imports Vue components, which a unit test cannot load. Read with the TypeScript parser.
 */
async function realManifests(): Promise<FeatureManifest[]> {
  const dir = path.join(repoRoot, 'src', 'features');
  const out: FeatureManifest[] = [];
  for (const feature of (await fs.readdir(dir)).sort()) {
    const file = path.join(dir, feature, 'index.ts');
    const text = await fs.readFile(file, 'utf8').catch(() => undefined);
    if (text === undefined) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    let manifest: FeatureManifest | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText() === 'defineFeature' &&
        node.arguments[0]
      ) {
        manifest = literal(node.arguments[0]) as unknown as FeatureManifest;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (!manifest?.id) throw new Error(`${feature}/index.ts: no defineFeature({ id, ... }) found`);
    out.push(manifest);
  }
  return out;
}

let app: WiredApp | undefined;
afterEach(async () => {
  if (app) {
    for (const feature of app.wiring.features) await feature.dispose?.();
    await app.cleanup();
  }
  app = undefined;
});

/** The shell a command gets, with the wired main side behind the typed client. */
function shellOf(wired: WiredApp): CommandShell {
  const bridge: Bridge = {
    async invoke(channel, input) {
      const handler = wired.wiring.handlers.get(channel);
      if (!handler) return err('ipc.unknown', `Unknown channel ${channel}.`);
      return handler(input === undefined ? undefined : JSON.parse(JSON.stringify(input)));
    },
    on: () => () => undefined,
  };
  return {
    client: (contract) => createClient(contract, bridge),
    go: async () => undefined,
    route: () => '/configure/games',
    machineChanged: () => undefined,
    progress: () => undefined,
  };
}

/** The installs of the recorded rig: its programs and Steam's manifests. */
const INSTALLS = ['Program Files (x86)/**/*.exe', 'Program Files (x86)/Steam/steamapps/*'];

/**
 * What a scenario's PC is offered: the games found (asked through the shell's follower, as
 * the window does), the Controls entries of the menu, and the palette with nothing typed.
 */
async function offeredOn(scenario: string, files?: string[]) {
  app = await wiredApp(scenario, files ? { files } : {});
  const shell = shellOf(app);
  const found = await new Promise<FoundGames>((resolve) => {
    const stop = followGamesFound(
      modules,
      shell,
      (games) => {
        stop();
        resolve(games);
      },
      () => () => undefined
    );
  });
  const manifests = await realManifests();
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const dynamic = await Promise.all(
    modules.map((module) => listDynamic(module, byId.get(module.feature), shell))
  );
  // As the palette has them (src/renderer/shell/shell.ts): sorted, then held to this PC.
  const palette = offeredHere(
    sortCommands([
      ...staticCommands(manifests, modules),
      ...dynamic.flatMap((listing) => listing.commands),
    ]),
    manifests,
    found
  );
  const menu = navSectionsOf(manifests, found);
  return {
    found,
    controls: menu.find((group) => group.section === 'Controls')!.entries.map((e) => e.title),
    entries: menu.flatMap((group) => group.entries).length,
    palette,
    titles: palette.map((command) => command.title),
    pages: palette.flatMap((command) => (command.to ? [command.to.split('?')[0]!] : [])),
  };
}

/** A page of the palette that is about DCS: its routes, or a name that says DCS. */
const aboutDcs = (titles: string[], pages: string[]): string[] => [
  ...titles.filter((title) => /\bDCS\b|Binding guide/.test(title)),
  ...pages.filter((to) => /^\/configure\/(dcs|dcs-bindings|ai-assist)(\/|$)/.test(to)),
];

describe('NAV-GAMES-006 an entry or a page about a game is offered where the game is found', () => {
  it('the binding guide is the one menu entry about a game, and it is about DCS', async () => {
    const manifests = await realManifests();
    const aboutAGame = manifests.flatMap((m) =>
      (m.nav ?? []).filter((entry) => entry.games).map((entry) => [entry.title, entry.games])
    );
    expect(aboutAGame).toEqual([['Binding guide', ['dcs']]]);
    // Its route stays, so a link to it still opens the page, which says DCS was not found.
    const guide = manifests.find((m) => m.id === 'ai-assist')!;
    expect(guide.routes?.map((r) => r.path)).toEqual(['/configure/ai-assist/:tab?']);
  });

  it('a PC with no game: no binding guide in the menu, no DCS page in the palette', async () => {
    const pc = await offeredOn('generic-fresh');
    expect(pc.found).toEqual([]);
    expect(pc.controls).toEqual(['Bindings', 'Cheat sheets', 'Overlay']);
    expect(pc.entries).toBe(17);
    expect(aboutDcs(pc.titles, pc.pages)).toEqual([]);
    // What is about no game in particular is all there, and Play's commands lead.
    expect(pc.titles).toEqual(
      expect.arrayContaining(['Games', 'Bindings', 'Cheat sheets', 'Overlay', 'Wheel', 'Settings'])
    );
    expect(pc.palette[0]!.group).toBe('Play');
  });

  it('a PC whose only game is iRacing: no DCS, and the racing pages are there', async () => {
    const pc = await offeredOn('shell-racing-pc');
    expect(pc.found).toEqual(['iracing']);
    expect(pc.controls).toEqual(['Bindings', 'Cheat sheets', 'Overlay']);
    expect(aboutDcs(pc.titles, pc.pages)).toEqual([]);
    expect(pc.titles).toEqual(expect.arrayContaining(['Racing', 'iRacing', 'iRacing bindings']));
    expect(pc.palette[0]!.group).toBe('Play');
  });

  it('a PC with DCS, the owner’s rig or another: the binding guide and every DCS page', async () => {
    const DCS_PAGES = [
      'Binding guide',
      'DCS World',
      'DCS World: Screens',
      'DCS World: Export.lua',
      'DCS World: SimAppPro',
      'DCS bindings',
      'DCS bindings: Devices',
      'DCS bindings: Actions',
      'DCS bindings: Problems',
      'DCS bindings: Device IDs',
      'DCS bindings: Copy',
      'DCS bindings: Snapshots',
    ];
    const other = await offeredOn('generic-dcs');
    expect(other.found).toEqual(['dcs']);
    expect(other.controls).toEqual(['Bindings', 'Binding guide', 'Cheat sheets', 'Overlay']);
    expect(other.entries).toBe(18);
    expect(other.titles).toEqual(expect.arrayContaining(DCS_PAGES));
    // Only DCS on that PC: the racing pages are not offered there.
    expect(other.titles).not.toContain('iRacing bindings');
    await app!.cleanup();
    app = undefined;

    const rig = await offeredOn('flying-all-good', INSTALLS);
    expect(rig.found).toEqual(expect.arrayContaining(['dcs', 'iracing']));
    expect(rig.controls).toEqual(['Bindings', 'Binding guide', 'Cheat sheets', 'Overlay']);
    expect(rig.titles).toEqual(
      expect.arrayContaining([...DCS_PAGES, 'Racing', 'iRacing bindings'])
    );
    expect(rig.palette[0]!.group).toBe('Play');
  });
});
