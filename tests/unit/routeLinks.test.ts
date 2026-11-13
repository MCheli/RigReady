/**
 * NAV-GAMES-004: no link in the app leads nowhere. Pages move (the DCS World and Racing
 * pages left the menu for Games, the DCS bindings for Bindings), and a check that offers
 * "Open ...", a button, a palette command or a page's own link written as an address must
 * still open a page. Every fixed address in the shipped sources is matched against the
 * routes the features declare and the shell's own Bindings route.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BINDINGS_ENTRY } from '../../src/shared/feature';
import { repoRoot } from '../helpers';

const src = path.join(repoRoot, 'src');

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'legacy') out.push(...(await sources(full)));
    } else if (/\.(ts|vue)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/**
 * The routes of every manifest, read as text (a manifest imports Vue components, which a
 * unit test cannot load): a top-level path, and its children joined to it.
 */
async function declaredRoutes(): Promise<string[]> {
  const routes: string[] = [BINDINGS_ENTRY.to];
  for (const feature of await fs.readdir(path.join(src, 'features'))) {
    const file = path.join(src, 'features', feature, 'index.ts');
    const text = await fs.readFile(file, 'utf8').catch(() => '');
    let parent = '';
    for (const match of text.matchAll(/\bpath:\s*'([^']*)'/g)) {
      const route = match[1]!;
      if (route.startsWith('/')) parent = route.replace(/\/:[^/]+\?$/, '');
      routes.push(route.startsWith('/') ? route : route ? `${parent}/${route}` : parent);
    }
  }
  return routes;
}

/** Whether an address opens a route: the same path, or one that fills in its parameters. */
function opens(address: string, routes: string[]): boolean {
  const parts = address.split('/');
  return routes.some((route) => {
    const pattern = route.split('/');
    for (let i = 0; i < Math.max(parts.length, pattern.length); i++) {
      const want = pattern[i];
      if (want === undefined) return false;
      if (want.startsWith(':')) {
        if (want.endsWith('?') && parts[i] === undefined) continue;
        if (parts[i] === undefined || parts[i] === '') return false;
        continue;
      }
      if (want !== parts[i]) return false;
    }
    return true;
  });
}

describe('links inside the app', () => {
  it('every fixed address written in the shipped sources opens a page', async () => {
    const routes = await declaredRoutes();
    expect(routes).toContain('/configure/dcs/screens');
    const dead: string[] = [];
    for (const file of await sources(src)) {
      const text = await fs.readFile(file, 'utf8');
      // A quoted address, or the fixed start of one built from a template ("/configure/x/${id}"
      // is checked up to the part that is filled in).
      for (const match of text.matchAll(/['"`](\/configure\/[A-Za-z0-9/_-]*)/g)) {
        const address = match[1]!.replace(/\/$/, '');
        const next = text[match.index! + match[0].length];
        // A route's own pattern ("/configure/backups/restore/:id"), or the prefix itself.
        if (next === ':' || address === '/configure') continue;
        const built = next === '$';
        if (built ? routes.some((r) => r.startsWith(`${address}/`)) : opens(address, routes)) {
          continue;
        }
        const line = text.slice(0, match.index).split('\n').length;
        dead.push(`${path.relative(repoRoot, file).replace(/\\/g, '/')}:${line}: ${address}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it('knows a dead address when it sees one', async () => {
    const routes = await declaredRoutes();
    expect(opens('/configure/dcs-setup', routes)).toBe(false);
    expect(opens('/configure/dcs', routes)).toBe(true);
    expect(opens('/configure/dcs-bindings/device-ids', routes)).toBe(true);
    expect(opens('/configure/games/dcs', routes)).toBe(true);
    expect(opens('/configure/games', routes)).toBe(true);
    expect(opens('/configure/bindings', routes)).toBe(true);
  });
});
