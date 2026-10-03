import type { z } from 'zod';
import type { Logger } from '../logger';
import type { Ports } from '../ports';
import type { CheckGroup, CheckItem } from '../profile/schema';
import type { Result } from '../result';

/** The setup a check, fix or action runs for. */
export interface RunProfile {
  id: string;
  name: string;
  /** Game module id, when the setup belongs to a known game. */
  game?: string;
  /** The install folder the setup uses, when it names one (see Profile.gameInstall). */
  install?: string;
}

export interface CheckContext {
  ports: Ports;
  log: Logger;
  /**
   * The setup being checked or fixed. Set by the engine; absent on Configure pages, which
   * are not about one setup. Path variables and script environments follow it.
   */
  profile?: RunProfile;
}

/** The same context, for one setup. */
export function withProfile<C extends CheckContext>(
  ctx: C,
  profile: { id: string; name: string; game?: string | undefined; gameInstall?: string | undefined }
): C {
  return {
    ...ctx,
    profile: {
      id: profile.id,
      name: profile.name,
      ...(profile.game ? { game: profile.game } : {}),
      ...(profile.gameInstall ? { install: profile.gameInstall } : {}),
    },
  };
}

export interface CheckOutcome {
  pass: boolean;
  /** One line: what is true right now. */
  summary: string;
  /** Extra lines, e.g. one per difference. */
  details?: string[];
  /**
   * True when the check could not be evaluated at all (a folder variable that does not
   * resolve, a script that is missing, a provider that failed). Shown as "error", not "failed".
   */
  error?: boolean;
  /** Longer captured text (script output), shown in an expandable panel. */
  output?: string;
}

/** Something a check type lets the user confirm on an item, e.g. "Mark verified". */
export interface CheckAcknowledge<P> {
  /** Button label. */
  label: string;
  /** Resolves with the item's new params, which the profile then stores. */
  run(params: P, ctx: CheckContext): Promise<Result<P>>;
}

export interface CheckDefinition<P = unknown> {
  /** Namespaced by feature, e.g. "device.connected". */
  type: string;
  group: CheckGroup;
  label: string;
  params: z.ZodType<P>;
  run(params: P, ctx: CheckContext): Promise<CheckOutcome>;
  /**
   * Optional: what Stand down does for an item of this type. Resolves with a message
   * describing what was done, or null when there was nothing to do.
   */
  standDown?(params: P, ctx: CheckContext): Promise<Result<string | null>>;
  /** Optional: an action that updates the item's own params (e.g. "Mark verified"). */
  acknowledge?: CheckAcknowledge<P>;
  /**
   * Remediation types that suit this check, offered first (and only these) in the setup
   * editor. Absent: every remediation type is offered.
   */
  fixes?: string[];
  /**
   * Seconds this item needs when its params say so (a script with its own timeout). Used
   * instead of the settings' check timeout unless the item sets one.
   */
  timeoutSeconds?(params: P): number | undefined;
  /** Never decides readiness: when not met it is a warning even on a required item. */
  advisory?: boolean;
}

/** The exact program a fix would run, shown to the user before it runs. */
export interface CommandPreview {
  exe: string;
  args: string[];
  cwd?: string;
}

export interface RemediationDefinition<P = unknown> {
  /** Namespaced by feature, e.g. "process.launch". */
  type: string;
  label: string;
  /** Make ready runs fixes in ascending order: apps 100, displays 200, files 300. */
  order: number;
  params: z.ZodType<P>;
  /** What the fix will do, shown next to the failing check. */
  describe(params: P): string;
  /** Resolves with a message describing what was done. */
  run(params: P, ctx: CheckContext): Promise<Result<string>>;
  /**
   * "instructions": the fix only tells the user what to do. Make ready never runs it and
   * never reports it as fixed; it lists it under "Needs you".
   * "navigate": the fix opens a screen where the user reviews and applies the change (a
   * previewed flow). Its button works on the item, the check is expected to stay as it is
   * until the user finishes there, and Make ready lists it under "Needs you" instead of
   * leaving the Fly screen in the middle of its run.
   * Default "action".
   */
  kind?: 'action' | 'instructions' | 'navigate';
  /** For kind "instructions": the text (Markdown subset) shown next to the item. */
  instructions?(params: P): string;
  /**
   * When present and it returns a command, the fix runs only after the user confirmed
   * that exact command. Make ready asks first; the tray skips it.
   */
  confirm?(params: P): CommandPreview | undefined;
  /**
   * Optional: whether the fix can run at all right now (e.g. a backup copy exists).
   * When it cannot, no fix is offered and the reason is shown on the item. When it can,
   * `description` may replace describe() with what was found ("Restore options.lua from
   * the copy of 3 Oct 12:00").
   */
  available?(
    params: P,
    ctx: CheckContext
  ): Promise<{ ok: true; description?: string } | { ok: false; reason: string }>;
  /**
   * Optional: something the setup editor offers while the fix is being set up, e.g.
   * "Keep a copy of the file as it is now" for a restore. Resolves with what was done.
   */
  prepare?: { label: string; run(params: P, ctx: CheckContext): Promise<Result<string>> };
}

/** A check proposed from the current state of the machine. */
export interface CaptureCandidate {
  /** Stable within one capture run. */
  key: string;
  group: CheckGroup;
  title: string;
  description?: string;
  selectedByDefault: boolean;
  check: Omit<CheckItem, 'id'>;
  /**
   * Game module id, for a check that only makes sense in a setup for that game (DCS's
   * Export.lua in a racing setup would be noise). The capture screen keeps such a
   * candidate by default only when the setup is for that game.
   */
  game?: string;
  /**
   * The image name of the program this candidate is about ("StreamDeck.exe"), when it is
   * about one program. Two candidates for the same program are one too many: the more
   * specific one stays (see `generic`), kept by default when either was.
   */
  program?: string;
  /** Set by the list of running apps: any other candidate for the same program replaces it. */
  generic?: boolean;
  /**
   * Programs this candidate checks in a better way than a plain "is running" check (it
   * finds the program wherever it is installed). Generic candidates for them are left out.
   */
  covers?: string[];
}

export interface CaptureDefinition {
  id: string;
  label: string;
  capture(ctx: CheckContext): Promise<Result<CaptureCandidate[]>>;
}

/** Something Stand down does once, whatever the profile's checks are (e.g. apply the desk layout). */
export interface StandDownStep {
  id: string;
  /** Shown as the step's title in the Stand down summary. */
  label: string;
  /** Steps run in ascending order, after the per-check stand-down actions. */
  order: number;
  /** Resolves with what was done, or null when there was nothing to do. */
  run(ctx: CheckContext): Promise<Result<string | null>>;
}

/**
 * Check, remediation and capture types are registered by features. There is no
 * central switch statement to edit.
 */
export class CheckRegistry {
  private checks = new Map<string, CheckDefinition>();
  private remediations = new Map<string, RemediationDefinition>();
  private captures = new Map<string, CaptureDefinition>();
  private steps = new Map<string, StandDownStep>();

  registerCheck<P>(definition: CheckDefinition<P>): void {
    if (this.checks.has(definition.type)) {
      throw new Error(`Check type registered twice: ${definition.type}`);
    }
    this.checks.set(definition.type, definition as CheckDefinition);
  }

  registerRemediation<P>(definition: RemediationDefinition<P>): void {
    if (this.remediations.has(definition.type)) {
      throw new Error(`Remediation type registered twice: ${definition.type}`);
    }
    this.remediations.set(definition.type, definition as RemediationDefinition);
  }

  registerCapture(definition: CaptureDefinition): void {
    if (this.captures.has(definition.id)) {
      throw new Error(`Capture registered twice: ${definition.id}`);
    }
    this.captures.set(definition.id, definition);
  }

  registerStandDownStep(step: StandDownStep): void {
    if (this.steps.has(step.id)) throw new Error(`Stand-down step registered twice: ${step.id}`);
    this.steps.set(step.id, step);
  }

  standDownSteps(): StandDownStep[] {
    return [...this.steps.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  }

  check(type: string): CheckDefinition | undefined {
    return this.checks.get(type);
  }

  remediation(type: string): RemediationDefinition | undefined {
    return this.remediations.get(type);
  }

  allCaptures(): CaptureDefinition[] {
    return [...this.captures.values()];
  }

  checkTypes(): string[] {
    return [...this.checks.keys()].sort();
  }

  remediationTypes(): string[] {
    return [...this.remediations.keys()].sort();
  }
}
