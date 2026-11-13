import type { RouteRecordRaw } from 'vue-router';

export interface RouteKinds {
  /** Pages of Play mode: full width, without the Configure navigation. */
  fly: RouteRecordRaw[];
  /** Pages that are a window of their own, with nothing of the app around them. */
  bare: RouteRecordRaw[];
  /** Everything else: the pages of Configure, under its navigation. */
  configure: RouteRecordRaw[];
}

/**
 * Sorts the routes the features declare by where they are shown. A route says it itself
 * (meta.bare, meta.mode); one that says nothing is a page of Configure and has to live
 * under /configure/.
 */
export function routeKinds(routes: readonly RouteRecordRaw[]): RouteKinds {
  const kinds: RouteKinds = { fly: [], bare: [], configure: [] };
  for (const route of routes) {
    if (route.meta?.bare === true) {
      if (!route.path.startsWith('/') || route.path.startsWith('/configure/')) {
        throw new Error(`Bare feature route ${route.path} must be a top-level address`);
      }
      kinds.bare.push(route);
    } else if (route.meta?.mode === 'fly') {
      kinds.fly.push(route);
    } else {
      if (!route.path.startsWith('/configure/')) {
        throw new Error(
          `Feature route ${route.path} must start with /configure/, or set meta.mode to 'fly' or meta.bare`
        );
      }
      kinds.configure.push(route);
    }
  }
  return kinds;
}

/**
 * Whether the address a window was opened on is a bare page. Asked once, before the app is
 * mounted: such a window gets the page alone, not the app's shell around it.
 */
export function opensBare(
  hash: string,
  resolve: (path: string) => { meta: { bare?: boolean } }
): boolean {
  const path = hash.replace(/^#/, '');
  return path.startsWith('/') && resolve(path).meta.bare === true;
}
