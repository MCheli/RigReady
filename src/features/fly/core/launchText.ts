/**
 * The words around a launch: what Launch runs before and after the game, and the line that
 * says the game is starting. Pure and free of Node, so the screen and Windows say the same.
 */

/** A step of a setup, as far as these lines need it. */
export interface PlannedStep {
  title: string;
  phase: 'preLaunch' | 'postLaunch' | 'standDown';
}

export type PlanPhase = 'preLaunch' | 'postLaunch';

const LEADS: Record<PlanPhase, string> = {
  preLaunch: 'Before launch',
  postLaunch: 'After launch',
};

/** How many steps a line names before it counts the rest. */
const NAMED = 3;

/**
 * "Before launch: Start a virtual controller". The steps are named in the order they run;
 * past three the rest are counted. Undefined when the setup has no step in that phase.
 */
export function planLine(steps: PlannedStep[], phase: PlanPhase): string | undefined {
  const titles = steps
    .filter((step) => step.phase === phase)
    .map((step) => step.title.trim())
    .filter((title) => title !== '');
  if (titles.length === 0) return undefined;
  const named = titles.slice(0, NAMED).join(', ');
  const rest = titles.length - NAMED;
  return `${LEADS[phase]}: ${named}${rest > 0 ? ` and ${rest} more` : ''}`;
}

/** What Launch will do around the game, one line per phase that has a step. */
export function planLines(steps: PlannedStep[]): { phase: PlanPhase; text: string }[] {
  return (['preLaunch', 'postLaunch'] as const).flatMap((phase) => {
    const text = planLine(steps, phase);
    return text ? [{ phase, text }] : [];
  });
}

/** What is said while the game comes up: on the screen, and by Windows once the window is gone. */
export interface StartingNotice {
  /** "Starting DCS World": the game by its own name. */
  title: string;
  /** Why nothing shows yet, and where RigReady went. */
  body: string;
}

/**
 * The line for the moment between the click and the game's own window. A game can take most
 * of a minute to show anything, and RigReady hides itself meanwhile: without this the empty
 * screen reads as a launch that failed.
 */
export function startingNotice(game: string, viaSteam: boolean): StartingNotice {
  return {
    title: `Starting ${game}`,
    body: `${
      viaSteam ? 'Steam is opening it, which can take a minute.' : 'It can take a minute to show.'
    } RigReady is out of the way while you play.`,
  };
}
