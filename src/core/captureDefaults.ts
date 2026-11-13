import type { GameNeed } from './checks/registry';
import { deviceKind, playedWith, type GearKind, type PlayedWith } from './gearKind';
import type { LaunchAction } from './profile/schema';
import type { GameKind } from '../shared/models';

/**
 * What a new setup is offered and keeps for a given choice of game. Pure, and in core, so
 * the capture screen, an assistant's "create a setup from this rig" and the tests decide
 * the same way.
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

/** A check as it goes into a new setup. */
export interface ProposedCheck {
  type: string;
  title: string;
  required: boolean;
  params: Record<string, unknown>;
  remediation?: { type: string; params: Record<string, unknown> } | undefined;
}

/** What of a capture candidate decides whether it is kept. A tracked file has none of it. */
interface Proposed extends Scoped {
  selectedByDefault: boolean;
  kind?: GameKind | undefined;
  forGames?: string[] | undefined;
  group?: string | undefined;
  title?: string | undefined;
  device?: { model?: string | undefined } | undefined;
  check?: { type: string; params: Record<string, unknown> } | undefined;
}

/**
 * A step before launch that gives a game something it needs and the rig does not have by
 * itself, as the rig offers it: what can be chosen for it right now, and the checks that
 * go with it.
 */
export interface StepOffer {
  need: GameNeed;
  /** The fix type the step runs. */
  type: string;
  label: string;
  picker: {
    param: string;
    choices: {
      value: string;
      label: string;
      fill?: Record<string, unknown> | undefined;
      current?: boolean | undefined;
    }[];
  };
  /** Checks the step depends on (the driver a virtual controller needs). */
  checks?: ProposedCheck[] | undefined;
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
 */
export function gearOf(candidate: Pick<Proposed, 'title' | 'device'>): GearKind | undefined {
  const kind = deviceKind(candidate.device?.model ?? candidate.title ?? '');
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
 * narrowed to the family of the game, to the games a helper says it is for, and to what
 * the game is played with. Everything else that was found stays offered, not ticked.
 */
export function keptByDefault(candidate: Proposed, choice: CaptureChoice): boolean {
  if (!offered(candidate, choice) || !candidate.selectedByDefault) return false;
  if (candidate.kind && choice.family && candidate.kind !== choice.family) return false;
  // A helper made for certain games: with no game chosen nothing says it does not fit.
  if (candidate.forGames && choice.game !== '' && !candidate.forGames.includes(choice.game)) {
    return false;
  }
  return suits(candidate, choice.uses ?? playedWith(undefined, choice.family));
}

/**
 * The choice a new setup works from once a game is picked: the game's family (or the one
 * the connected gear says, for no game or a game RigReady does not know) and what the
 * game is played with.
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
 * The aircraft or cars of a game that something on this PC is set up for, in the order
 * found. A new setup starts with the first.
 */
export function variantsOf<V extends { id: string }>(
  candidates: { game?: string | undefined; variant?: V | undefined }[],
  game: string
): V[] {
  const seen = new Map<string, V>();
  for (const candidate of candidates) {
    if (candidate.variant && candidate.game === game && !seen.has(candidate.variant.id)) {
      seen.set(candidate.variant.id, candidate.variant);
    }
  }
  return [...seen.values()];
}

/**
 * The steps before launch the chosen game needs, of those the rig can offer: a game that
 * reads a gamepad and not sim gear gets "Start a virtual controller".
 */
export function stepsFor<S extends StepOffer>(steps: S[], choice: CaptureChoice): S[] {
  return steps.filter((step) => step.need === 'gamepad' && choice.uses?.gamepad === true);
}

/**
 * What a step starts with: the one in use right now, else the only one there is. With
 * several and none in use nothing is chosen, and the step is not kept until the person
 * says which: RigReady does not guess between two controllers.
 */
export function stepDefault(step: StepOffer): string | undefined {
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
  step: StepOffer,
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

const sameCheck = (a: Pick<ProposedCheck, 'type' | 'params'>, b: typeof a): boolean =>
  a.type === b.type && JSON.stringify(a.params) === JSON.stringify(b.params);

/**
 * The checks that go with the steps a new setup keeps: a step that needs a driver brings
 * the check that the driver is installed, kept until the person leaves it out (`left`, by
 * check type). A check the setup keeps already is not added a second time.
 */
export function stepChecks(
  keptSteps: StepOffer[],
  left: ReadonlySet<string> = new Set(),
  already: Pick<ProposedCheck, 'type' | 'params'>[] = []
): ProposedCheck[] {
  const checks: ProposedCheck[] = [];
  for (const check of keptSteps.flatMap((step) => step.checks ?? [])) {
    if (left.has(check.type)) continue;
    if ([...already, ...checks].some((other) => sameCheck(other, check))) continue;
    checks.push(check);
  }
  return checks;
}

/**
 * A new setup as the capture screen has it before anyone changes a tick: the game's first
 * aircraft or car, the checks kept by default, the files it backs up, and the steps the
 * game needs (those with a clear choice) with the checks that go with them. The screen
 * starts from these rules, and an assistant's "create a setup from this rig" saves this.
 * With `everything`, every check the page would list for the game is kept, ticked or not.
 */
export function proposedSetup<
  C extends Proposed & { variant?: { id: string } | undefined },
  T extends Scoped & { selectedByDefault: boolean },
  S extends StepOffer,
>(
  read: {
    candidates: C[];
    tracked?: T[] | undefined;
    steps?: S[] | undefined;
    games: { id: string; kind?: GameKind | undefined; uses?: PlayedWith | undefined }[];
    suggested: { kind?: GameKind | undefined };
  },
  game: string,
  options: { everything?: boolean } = {}
): {
  choice: CaptureChoice;
  variant: NonNullable<C['variant']> | undefined;
  kept: C[];
  tracked: T[];
  steps: LaunchAction[];
  stepChecks: ProposedCheck[];
} {
  const variant = variantsOf<NonNullable<C['variant']>>(read.candidates, game)[0];
  const choice = choiceFor(read, game, variant?.id ?? '');
  const kept = read.candidates.filter((c) =>
    options.everything ? offered(c, choice) : keptByDefault(c, choice)
  );
  const keptSteps = stepsFor(read.steps ?? [], choice).flatMap((step, index) => {
    const action = stepAction(step, stepDefault(step), 'a' + (index + 1));
    return action ? [{ step, action }] : [];
  });
  return {
    choice,
    variant,
    kept,
    tracked: (read.tracked ?? []).filter((t) => offered(t, choice) && t.selectedByDefault),
    steps: keptSteps.map((k) => k.action),
    stepChecks: stepChecks(
      keptSteps.map((k) => k.step),
      new Set(),
      kept.flatMap((c) => (c.check ? [c.check] : []))
    ),
  };
}
