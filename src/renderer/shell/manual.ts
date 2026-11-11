import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { manualPageFor, manualUrl, type ManualPage } from '../../shared/manualLinks';

/**
 * Opening the manual. The page is on the website, so it opens in the browser: the window
 * hands an https address to the system (setWindowOpenHandler in src/main/index.ts, which
 * opens https only and never navigates the app window). Without a connection the browser
 * says so; RigReady itself is not affected.
 */

/** The manual page about the screen shown (the deepest route record, and its tab). */
export function manualPageOfRoute(route: RouteLocationNormalizedLoaded): ManualPage {
  return manualPageFor({
    matched: route.matched[route.matched.length - 1]?.path,
    params: route.params,
    query: route.query,
  });
}

export function openManual(page?: ManualPage, anchor?: string): void {
  window.open(manualUrl(page, anchor), '_blank', 'noopener');
}
