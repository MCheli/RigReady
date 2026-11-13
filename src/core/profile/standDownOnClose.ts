import { z } from 'zod';
import type { Profile } from './schema';

/**
 * Stand down by itself when the game closes: what one setup says about it.
 *
 * Every setup has its own answer, kept with the setup in profile.extensions.fly:
 *
 *   extensions:
 *     fly:
 *       standDownOnClose: true        # the switch, on unless it says false
 *       standDownAfterSeconds: 60     # the countdown before Stand down runs
 *
 * The Play screen acts on it and the setup editor edits it, which is why it lives here
 * and not in either feature.
 *
 * A setup saved before this existed has no entry and gets the defaults: on, one minute.
 * A value a hand edit got wrong (a word for the switch, a length outside the limits)
 * falls back to its default as well, so a typing mistake never leaves a setup without an
 * answer and never makes the countdown shorter than somebody can react to.
 */
export const STAND_DOWN_EXTENSION = 'fly';
export const STAND_DOWN_DEFAULT_SECONDS = 60;
/** Short enough to be "at once", long enough to read the notice and press Cancel. */
export const STAND_DOWN_MIN_SECONDS = 5;
export const STAND_DOWN_MAX_SECONDS = 3600;

export const StandDownOnCloseSchema = z.object({
  standDownOnClose: z.boolean().catch(true),
  standDownAfterSeconds: z
    .number()
    .int()
    .min(STAND_DOWN_MIN_SECONDS)
    .max(STAND_DOWN_MAX_SECONDS)
    .catch(STAND_DOWN_DEFAULT_SECONDS),
});

export interface StandDownOnClose {
  /** Stand down runs by itself once the game has closed. */
  enabled: boolean;
  /** How long the countdown is, in whole seconds. */
  seconds: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What the setup says; the defaults for whatever it does not say. */
export function standDownOnClose(profile: Pick<Profile, 'extensions'>): StandDownOnClose {
  const raw = profile.extensions[STAND_DOWN_EXTENSION];
  // An entry that is not a list of settings at all (a word, a number) says nothing.
  const parsed = StandDownOnCloseSchema.parse(isRecord(raw) ? raw : {});
  return { enabled: parsed.standDownOnClose, seconds: parsed.standDownAfterSeconds };
}

/** A length inside the limits, in whole seconds. */
export function standDownSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return STAND_DOWN_DEFAULT_SECONDS;
  return Math.min(STAND_DOWN_MAX_SECONDS, Math.max(STAND_DOWN_MIN_SECONDS, Math.round(seconds)));
}

/** A copy of the setup that says this. Anything else kept under extensions.fly stays. */
export function withStandDownOnClose<P extends Pick<Profile, 'extensions'>>(
  profile: P,
  value: StandDownOnClose
): P {
  const raw = profile.extensions[STAND_DOWN_EXTENSION];
  return {
    ...profile,
    extensions: {
      ...profile.extensions,
      [STAND_DOWN_EXTENSION]: {
        ...(isRecord(raw) ? raw : {}),
        standDownOnClose: value.enabled,
        standDownAfterSeconds: standDownSeconds(value.seconds),
      },
    },
  };
}

/** "10 seconds", "1 minute", "1 minute 30 seconds": a countdown's length in words. */
export function standDownWaitText(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  const parts = [
    ...(minutes > 0 ? [`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`] : []),
    ...(rest > 0 || minutes === 0 ? [`${rest} ${rest === 1 ? 'second' : 'seconds'}`] : []),
  ];
  return parts.join(' ');
}
