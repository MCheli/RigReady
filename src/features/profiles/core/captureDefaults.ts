import {
  deviceKind,
  playedWith,
  type DeviceKind,
  type GearKind,
  type PlayedWith,
} from '../../../core/gearKind';
import type { LaunchAction } from '../../../core/profile/schema';
import type { GameKind } from '../../../shared/models';
import type { CaptureStep } from '../contract';

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
  /**
   * What the chosen game is played with, as its game module says (see core/gearKind).
   * Absent: what a game of the family usually uses.
   */
  uses?: PlayedWith | undefined;
}

interface Scoped {
  game?: string | undefined;
  variant?: { id: string } | string | undefined;
}

/** What of a capture candidate decides whether it is kept. A tracked file has none of it. */
interface Proposed extends Scoped {
  selectedByDefault: boolean;
  kind?: GameKind | undefined;
  group?: string | undefined;
  title?: string | undefined;
  device?: { model?: string | undefined; saidKind?: DeviceKind | undefined } | undefined;
  check?: { type: string; params: Record<string, unknown> } | undefined;
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

/**
 * The kind of gear a device is, or a program is for ("TrackIR software" is for a head
 * tracker, "Stream Deck app" for a button deck), told from its name. Undefined for gear
 * nobody can tell from the name and for programs that are not about one piece of gear.
 * What the user said a device is, on the Devices page, comes before its name.
 */
export function gearOf(candidate: Pick<Proposed, 'title' | 'device'>): GearKind | undefined {
  const kind =
    candidate.device?.saidKind ?? deviceKind(candidate.device?.model ?? candidate.title ?? '');
  return kind === 'other' || kind === 'keyboard' || kind === 'mouse' ? undefined : kind;
}

const isMicrophone = (candidate: Proposed): boolean =>
  candidate.check?.type === 'audio.defaultDevice' && candidate.check.params['flow'] === 'recording';

/**
 * Whether the game plausibly needs it. Gear of a kind the game does not read is left
 * out, and so is the program that runs such gear: a head tracker's software is not kept
 * for a game that reads no head tracker, however long it has been running. A helper
 * program about no particular gear is kept unless the game is played without helpers.
 * Gear that cannot be told from its name is kept: it is more likely the stick of a small
 * maker than something the game cannot use.
 */
function suits(candidate: Proposed, uses: PlayedWith): boolean {
  if (isMicrophone(candidate)) return uses.microphone;
  if (candidate.group !== 'devices' && candidate.group !== 'apps') return true;
  const gear = gearOf(candidate);
  if (gear) return !uses.gear || uses.gear.includes(gear);
  return candidate.group === 'apps' ? uses.helpers : true;
}

/**
 * Ticked until the user says otherwise: what the rig proposes (`selectedByDefault`),
 * narrowed to the family of the game and to what the game is played with. Everything
 * else that was found stays offered, not ticked.
 */
export function keptByDefault(candidate: Proposed, choice: CaptureChoice): boolean {
  if (!offered(candidate, choice) || !candidate.selectedByDefault) return false;
  if (candidate.kind && choice.family && candidate.kind !== choice.family) return false;
  return suits(candidate, choice.uses ?? playedWith(undefined, choice.family));
}

/**
 * The choice the capture screen works from once a game is picked: the game's family (or
 * the one the connected gear says, for no game or a game RigReady does not know) and what
 * the game is played with.
 */
export function choiceFor(
  captured: {
    games: { id: string; kind?: GameKind | undefined; uses?: PlayedWith | undefined }[];
    suggested: { kind?: GameKind | undefined };
  },
  game: string,
  variant = ''
): CaptureChoice {
  const found = captured.games.find((g) => g.id === game);
  const family = found?.kind ?? captured.suggested.kind;
  return { game, variant, family, uses: found?.uses ?? playedWith(undefined, family) };
}

/**
 * The steps before launch the chosen game needs, of those the rig can offer: a game that
 * reads a gamepad and not sim gear gets "Start a virtual controller".
 */
export function stepsFor(steps: CaptureStep[], choice: CaptureChoice): CaptureStep[] {
  return steps.filter((step) => step.need === 'gamepad' && choice.uses?.gamepad === true);
}

/**
 * What a step starts with: the one in use right now, else the only one there is. With
 * several and none in use nothing is chosen, and the step is not kept until the person
 * says which: RigReady does not guess between two controllers.
 */
export function stepDefault(step: CaptureStep): string | undefined {
  const { choices } = step.picker;
  const clear = choices.find((c) => c.current) ?? (choices.length === 1 ? choices[0] : undefined);
  return clear?.value;
}

/**
 * The step as it goes into the new setup, or nothing when what was chosen is not in the
 * list. A game that needs the step is not worth starting without it, so a failure asks
 * before the launch goes on.
 */
export function stepAction(
  step: CaptureStep,
  value: string | undefined,
  id: string
): LaunchAction | undefined {
  const chosen = step.picker.choices.find((c) => c.value === value);
  if (!chosen) return undefined;
  return {
    id,
    title: step.label,
    type: step.type,
    params: { [step.picker.param]: chosen.value, ...(chosen.fill ?? {}) },
    continueOnError: false,
    delaySeconds: 0,
  };
}
