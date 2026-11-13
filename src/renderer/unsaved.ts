import { onBeforeUnmount, onMounted } from 'vue';
import type { RouteLocationRaw, Router } from 'vue-router';

/**
 * Changes on screen that are not saved yet, held by the part of the page that keeps them
 * (the Save bar, the setup editor). Leaving the page by a link is asked about by that part's
 * own route guard. Opening the page on screen afresh runs no guard, so a command that does
 * so (the palette's, `shell/go.ts`) asks here first.
 */
export interface Unsaved {
  /** There are changes on screen that opening the page afresh would drop. */
  dirty(): boolean;
  /** Asks the user whether to drop them: true to go on, false to keep editing. */
  ask(): Promise<boolean>;
}

const held = new Set<Unsaved>();

/** Held from now on; the function returned lets go of it. */
export function holdUnsaved(unsaved: Unsaved): () => void {
  held.add(unsaved);
  return () => {
    held.delete(unsaved);
  };
}

/** In a component's setup: held for as long as the component is on screen. */
export function useUnsaved(unsaved: Unsaved): void {
  let off: (() => void) | undefined;
  onMounted(() => {
    off = holdUnsaved(unsaved);
  });
  onBeforeUnmount(() => off?.());
}

/** Whether anything on screen holds changes that are not saved. */
export const unsavedOnScreen = (): boolean => [...held].some((unsaved) => unsaved.dirty());

/**
 * Asks each part with unsaved changes in turn, and stops at the first that is kept. True
 * when there was nothing to ask, or every one may be dropped.
 */
export async function mayDropUnsaved(): Promise<boolean> {
  for (const unsaved of [...held]) {
    if (unsaved.dirty() && !(await unsaved.ask())) return false;
  }
  return true;
}

/**
 * The way out the user agreed to ("Leave without saving", "Discard"). While that move is
 * under way, its redirects included, `open()` is true and the guard of the part that asked
 * lets it through. Once it has settled it is closed again, whether the page went (then
 * nothing is left to ask about) or the move was stopped or turned back elsewhere: the next
 * way out asks again.
 */
export interface WayOut {
  /** The agreed move is under way: the guard lets it through. */
  open(): boolean;
  /** Makes that move. */
  go(to: RouteLocationRaw): Promise<void>;
}

export function wayOut(router: Pick<Router, 'push'>): WayOut {
  let going = 0;
  return {
    open: () => going > 0,
    async go(to) {
      going++;
      try {
        await router.push(to);
      } finally {
        going--;
      }
    },
  };
}
