import type { Profile } from '../../../core/profile/schema';

/**
 * Whether the overlay shows while a setup is the one in use: what that setup says, kept with
 * the setup in profile.extensions.overlay:
 *
 *   extensions:
 *     overlay:
 *       on: false        # the user's switch in the setup editor
 *
 * A setup that says nothing (made before this existed, or never switched) goes by what
 * RigReady can read for its game: on where it can read the game's bindings, so a press can
 * be shown with what it does, off where it cannot (`OverlayService.setupDefault`). Nothing
 * here knows a game by name. A value a hand edit got wrong says nothing either.
 */
export const OVERLAY_EXTENSION = 'overlay';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What the user chose for this setup; undefined when the setup says nothing. */
export function overlayChoice(profile: Pick<Profile, 'extensions'>): boolean | undefined {
  const raw = profile.extensions[OVERLAY_EXTENSION];
  const on = isRecord(raw) ? raw['on'] : undefined;
  return typeof on === 'boolean' ? on : undefined;
}

/** A copy of the setup with the overlay on or off in it. Anything else kept there stays. */
export function withOverlayChoice<P extends Pick<Profile, 'extensions'>>(
  profile: P,
  on: boolean
): P {
  const raw = profile.extensions[OVERLAY_EXTENSION];
  return {
    ...profile,
    extensions: {
      ...profile.extensions,
      [OVERLAY_EXTENSION]: { ...(isRecord(raw) ? raw : {}), on },
    },
  };
}
