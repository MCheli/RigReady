import { onBeforeUnmount } from 'vue';
import { useRouter, type Router } from 'vue-router';

/**
 * A page that moves the user on once main has answered (a setup created, a copy made) asks
 * first whether the user is still where they were when they pressed the button. On a slow
 * or busy PC the answer can come after they went on to another page: they stay there.
 *
 *   const stillHere = useStillHere();
 *   const here = stillHere();              // as the button is pressed
 *   const result = await api.create(...);
 *   if (result.ok && here()) await router.push('/');
 */
export function useStillHere(): () => () => boolean {
  let gone = false;
  onBeforeUnmount(() => {
    gone = true;
  });
  return stillHereOn(useRouter(), () => gone);
}

/**
 * The rule itself: still on the same address, and the page that asked is still the one
 * shown (not left and opened afresh in the meantime).
 */
export function stillHereOn(router: Router, gone: () => boolean): () => () => boolean {
  return () => {
    const from = router.currentRoute.value.fullPath;
    return () => !gone() && router.currentRoute.value.fullPath === from;
  };
}
