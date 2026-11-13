import { isNavigationFailure, NavigationFailureType, type Router } from 'vue-router';
import { mayDropUnsaved, unsavedOnScreen } from '../unsaved';

const leaf = (matched: { path: string }[]): string | undefined => matched[matched.length - 1]?.path;

/**
 * Opens a route for a command (`CommandShell.go`).
 *
 * Another page is a plain navigation, which the page being left may stop: its Save bar asks
 * first. The page already on screen is opened afresh (`afresh`), so that it reads the
 * parameters of the link whether or not it watches its route. That runs no route guard, so
 * changes that are not saved are looked after here:
 * - a link to the very address on screen leaves the page as it is, changes and all;
 * - a link that needs the page opened again asks first, through the part that holds them,
 *   and does nothing when the user keeps editing.
 */
export async function goTo(router: Router, to: string, afresh: () => void): Promise<void> {
  const target = router.resolve(to);
  const now = router.currentRoute.value;
  if (leaf(target.matched) !== leaf(now.matched)) {
    await router.push(to);
    return;
  }
  if (unsavedOnScreen()) {
    if (target.fullPath === now.fullPath) return;
    if (!(await mayDropUnsaved())) return;
  }
  const failure = await router.push(to);
  // A guard of the page kept it where it is (it asked, and the user went on editing).
  if (failure && !isNavigationFailure(failure, NavigationFailureType.duplicated)) return;
  afresh();
}
