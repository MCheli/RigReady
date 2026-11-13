import { onBeforeUnmount, onMounted } from 'vue';

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
