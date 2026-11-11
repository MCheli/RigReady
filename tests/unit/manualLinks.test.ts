import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { manualUrl as siteManualUrl } from '../../site/lib/manual.mjs';
import {
  MANUAL_HOME,
  MANUAL_LINKS,
  MANUAL_SITE,
  TROUBLESHOOTING,
  manualPageFor,
  manualUrl,
  noticeManualPage,
} from '../../src/shared/manualLinks';
import { repoRoot } from '../helpers';

/**
 * The app and its manual are connected (src/shared/manualLinks.ts): every route of every
 * feature has a page of the manual, and every page named exists in docs/manual and has the
 * address the website gives it.
 */

const featuresDir = path.join(repoRoot, 'src', 'features');
const manualDir = path.join(repoRoot, 'docs', 'manual');

const stringOf = (node: ts.Expression | undefined): string | undefined =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

function property(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of object.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === name) return p.initializer;
  }
  return undefined;
}

/** The routes a manifest declares, children joined to their parent, as vue-router joins them. */
function routesOf(array: ts.ArrayLiteralExpression, parent = ''): string[] {
  const out: string[] = [];
  for (const element of array.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue;
    const own = stringOf(property(element, 'path'));
    if (own === undefined) continue;
    const full = own.startsWith('/') ? own : own === '' ? parent : `${parent}/${own}`;
    out.push(full);
    const children = property(element, 'children');
    if (children && ts.isArrayLiteralExpression(children)) out.push(...routesOf(children, full));
  }
  return out;
}

/**
 * Read from the manifests' source: the manifests import Vue components, which a unit test
 * cannot load. A route the parser cannot see would fail below as a stale entry.
 */
async function appRoutes(): Promise<string[]> {
  const routes: string[] = [];
  for (const feature of await fs.readdir(featuresDir)) {
    const file = path.join(featuresDir, feature, 'index.ts');
    if (!existsSync(file)) continue;
    const source = ts.createSourceFile(
      file,
      await fs.readFile(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        node.name.getText() === 'routes' &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        routes.push(...routesOf(node.initializer));
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return routes;
}

const linkedPages = (): string[] => [
  MANUAL_HOME,
  ...Object.values(TROUBLESHOOTING),
  ...Object.values(MANUAL_LINKS).flatMap((link) => [
    link.page,
    ...Object.values(link.variants?.pages ?? {}),
  ]),
];

describe('the manual map', () => {
  it('has a manual page for every route of the app', async () => {
    const routes = await appRoutes();
    expect(routes.length).toBeGreaterThan(30);
    expect(routes).toContain('/fly');
    expect(routes).toContain('/configure/devices/test');
    const missing = routes.filter((route) => !(route in MANUAL_LINKS));
    expect(missing, 'routes without a manual page in src/shared/manualLinks.ts').toEqual([]);
  });

  it('has no entry for a route the app does not have', async () => {
    const routes = new Set(await appRoutes());
    const stale = Object.keys(MANUAL_LINKS).filter((route) => !routes.has(route));
    expect(stale, 'entries for routes that no longer exist').toEqual([]);
  });

  it('names only pages that exist in docs/manual', () => {
    const absent = [...new Set(linkedPages())].filter(
      (page) => !existsSync(path.join(manualDir, `${page}.md`))
    );
    expect(absent, 'manual pages that do not exist').toEqual([]);
  });

  it('builds the address the website gives each page', () => {
    for (const page of new Set(linkedPages())) {
      expect(manualUrl(page)).toBe(`${MANUAL_SITE}${siteManualUrl(`${page}.md`)}`);
    }
    expect(manualUrl()).toBe('https://rigready.io/docs/');
    expect(manualUrl('hardware/devices')).toBe('https://rigready.io/docs/hardware/devices/');
    expect(manualUrl('dcs/index')).toBe('https://rigready.io/docs/dcs/');
    expect(manualUrl('app/settings', 'startup')).toBe(
      'https://rigready.io/docs/app/settings/#startup'
    );
  });

  it('opens only https addresses', () => {
    for (const page of linkedPages()) expect(manualUrl(page)).toMatch(/^https:\/\//);
  });
});

describe('the page for the screen shown', () => {
  it('is the route’s page, or the tab’s or the game’s own page when it has one', () => {
    expect(manualPageFor({ matched: '/configure/devices/test' })).toBe('hardware/input-tester');
    expect(manualPageFor({ matched: '/configure/backups', query: { tab: 'tracked' } })).toBe(
      'protect/tracked-files'
    );
    expect(manualPageFor({ matched: '/configure/backups', query: {} })).toBe('protect/backups');
    expect(
      manualPageFor({ matched: '/configure/dcs-bindings/:tab?', params: { tab: 'device-ids' } })
    ).toBe('dcs/device-ids');
    expect(
      manualPageFor({ matched: '/configure/dcs-bindings/:tab?', params: { tab: 'devices' } })
    ).toBe('dcs/bindings');
    expect(manualPageFor({ matched: '/configure/games/:id', params: { id: 'iracing' } })).toBe(
      'games/iracing'
    );
    expect(manualPageFor({ matched: '/configure/games/:id', params: { id: 'unknown' } })).toBe(
      'games/other-games'
    );
    expect(manualPageFor({ matched: '/configure/backups', query: { tab: ['snapshots'] } })).toBe(
      'protect/snapshots'
    );
  });

  it('is the manual’s front page where the app is somewhere it has no page for', () => {
    expect(manualPageFor({ matched: undefined })).toBe(MANUAL_HOME);
    expect(manualPageFor({ matched: '/:rest(.*)*' })).toBe(MANUAL_HOME);
  });
});

describe('the notices at the start', () => {
  it('link setup files to their page and every other data file to the data folder’s', () => {
    expect(
      noticeManualPage(
        'Some setup files could not be read: 1 file. They are listed under Configure > Setups, where each can be fixed or deleted.'
      )
    ).toBe(TROUBLESHOOTING.setupFileUnreadable);
    expect(noticeManualPage('The settings file could not be read, so defaults are in use.')).toBe(
      TROUBLESHOOTING.dataFileDamaged
    );
    expect(noticeManualPage('The saved monitor layouts could not be read.')).toBe(
      TROUBLESHOOTING.dataFileDamaged
    );
  });
});
