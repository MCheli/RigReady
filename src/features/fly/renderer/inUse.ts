import type { ProfileSummary } from '../contract';

/**
 * Whether a screen that loads (or loads again) notes the setup it shows as the one in use.
 *
 * Showing a setup is not choosing it. A reload happens by itself (a setup file changed,
 * another window switched), and its check is sent a moment after it read which setup is in
 * use. If that check claimed the setup on screen, a switch made in the tray or the compact
 * view in that moment was undone: on a slow machine the setup "bounced back".
 *
 * Only a setup that was never in use is noted, so the first one a new user sees becomes the
 * one used last. A setup that is in use by memory has been used, and needs no noting.
 */
export function claimsOnLoad(
  profiles: readonly Pick<ProfileSummary, 'id' | 'lastUsed'>[],
  activeId: string | undefined
): boolean {
  if (!activeId) return false;
  const shown = profiles.find((profile) => profile.id === activeId);
  return shown !== undefined && shown.lastUsed === undefined;
}
