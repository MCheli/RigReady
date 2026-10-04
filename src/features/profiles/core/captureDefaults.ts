import type { GameKind } from '../../../shared/models';

/**
 * What the capture screen offers and keeps for a given choice of game. Pure, so the
 * screen and the tests decide the same way.
 */
export interface CaptureChoice {
  /** '' for no particular game, 'other' for a game without a module, else a game module id. */
  game: string;
  /** The aircraft or car chosen, when the game has any. */
  variant: string;
  /** The family whose gear suits the setup: the game's, else what the connected gear says. */
  family?: GameKind | undefined;
}

interface Scoped {
  game?: string | undefined;
  variant?: { id: string } | string | undefined;
}

const variantId = (variant: Scoped['variant']): string | undefined =>
  typeof variant === 'string' ? variant : variant?.id;

/** Offered at all: what belongs to another game, or to another aircraft or car, is not shown. */
export function offered(item: Scoped, choice: CaptureChoice): boolean {
  if (item.game && item.game !== choice.game) return false;
  const variant = variantId(item.variant);
  if (variant && variant !== choice.variant) return false;
  return true;
}

/** Ticked until the user says otherwise. */
export function keptByDefault(
  candidate: Scoped & { selectedByDefault: boolean; kind?: GameKind | undefined },
  choice: CaptureChoice
): boolean {
  if (!offered(candidate, choice) || !candidate.selectedByDefault) return false;
  return !candidate.kind || !choice.family || candidate.kind === choice.family;
}
