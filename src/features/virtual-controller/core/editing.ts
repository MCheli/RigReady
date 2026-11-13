import type { PadProfile } from './profile';

/** One text for one content, whatever order the parts were touched in. */
export const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );

/** What the editor holds once a save has answered. */
export interface AfterSave {
  /** The profile on screen. */
  shown: PadProfile;
  /** What the profile on screen is compared with to say whether something is unsaved. */
  savedCopy: string;
  /** The profile was changed while the save was under way: those changes are not saved. */
  changedMeanwhile: boolean;
}

/**
 * The editor stays open for editing while a save runs. Once main answers, its copy is what
 * is saved, and it takes the place of the profile on screen only when nothing was changed
 * since Save was pressed (`sent` is the profile as it was then, made `stable`). A change made
 * in the meantime stays on screen and still reads as unsaved.
 */
export function afterSave(onScreen: PadProfile, sent: string, saved: PadProfile): AfterSave {
  const changedMeanwhile = stable(onScreen) !== sent;
  return {
    shown: changedMeanwhile ? onScreen : saved,
    savedCopy: stable(saved),
    changedMeanwhile,
  };
}
