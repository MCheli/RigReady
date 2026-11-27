import { z } from 'zod';
import { err, ok, type Result } from '../../../core/result';
import { ChangePreviewSchema } from '../../../shared/changePreview';
import type { Envelope } from '../../../shared/ipc';

/**
 * The binding guide for Nuclear Option. The game has one set of bindings for every aircraft,
 * so there is one guide. What is bound is read through the bindings registry, like DCS's; a
 * controller button is bound through the Nuclear Option bindings feature's change channels,
 * the same review, backup and Undo its own page uses. Nothing here reads or writes the
 * registry, and nothing imports that feature.
 */

export const NUCLEAR_OPTION = 'nuclear-option';
/** The one entry the guide lists for the game. */
export const NUCLEAR_OPTION_GUIDE = `${NUCLEAR_OPTION}:all`;
/** The bindings reader's id for the one set of bindings. */
export const NUCLEAR_OPTION_SET = 'all';

export const isNuclearOptionId = (id: string): boolean =>
  id.toLowerCase().startsWith(`${NUCLEAR_OPTION}:`);

/**
 * What the guide binds here: a button-type action as a whole. An axis, and one side of an
 * axis on a button (its id ends in ":+" or ":-"), are bound in the game.
 */
export const bindsHere = (action: { id: string; kind: 'button' | 'axis' }): boolean =>
  action.kind === 'button' && /^\d+$/.test(action.id);

// What the Nuclear Option bindings feature answers: only the fields used here are read.

export const NuclearOptionOverviewSchema = z.object({
  devices: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['controller', 'keyboard', 'mouse']),
      name: z.string(),
      guid: z.string().optional(),
    })
  ),
});
export type NuclearOptionOverview = z.infer<typeof NuclearOptionOverviewSchema>;

export const NuclearOptionReviewSchema = z.object({
  device: z.string(),
  action: z.string(),
  before: z.string(),
  after: z.string(),
  same: z.boolean(),
  alsoOnButton: z.array(z.string()),
  blocked: z.string().optional(),
  preview: ChangePreviewSchema,
  seen: z.string(),
});
export type NuclearOptionReview = z.infer<typeof NuclearOptionReviewSchema>;

export const NuclearOptionChangedSchema = z.object({ changed: z.boolean(), message: z.string() });
export type NuclearOptionChanged = z.infer<typeof NuclearOptionChangedSchema>;

/** A button the user pressed: the controller by its DirectInput instance GUID, the first button 1. */
export const NuclearOptionWantedSchema = z.object({
  device: z.string().min(1).max(64),
  button: z.number().int().min(1).max(128),
});
export type NuclearOptionWanted = z.infer<typeof NuclearOptionWantedSchema>;

export interface NuclearOptionRequest {
  /** The controller, by the bindings feature's own id. */
  device: string;
  actionId: number;
  button: number;
  seen?: string;
}

/** Nuclear Option's bindings as the guide changes them. */
export interface NuclearOptionBindings {
  overview(): Promise<Result<NuclearOptionOverview>>;
  changePreview(request: NuclearOptionRequest): Promise<Result<NuclearOptionReview>>;
  change(request: NuclearOptionRequest): Promise<Result<NuclearOptionChanged>>;
}

/**
 * The Nuclear Option bindings feature's channels, called with the same validation a window
 * gets. An answer in a form this does not know is an error, never a guess.
 */
export function nuclearOptionThroughChannels(
  invoke: (channel: string, input?: unknown) => Promise<Envelope>
): NuclearOptionBindings {
  async function call<T>(channel: string, input: unknown, schema: z.ZodType<T>) {
    const answer = await invoke(`nuclear-option-bindings:${channel}`, input);
    if (!answer.ok) return answer;
    const parsed = schema.safeParse(answer.value);
    return parsed.success
      ? ok(parsed.data)
      : err(
          'ai.nuclearOptionAnswer',
          'The Nuclear Option bindings answered in a form the binding guide does not know.',
          z.prettifyError(parsed.error)
        );
  }
  return {
    overview: () => call('overview', undefined, NuclearOptionOverviewSchema),
    changePreview: (request) => call('changePreview', request, NuclearOptionReviewSchema),
    change: (request) => call('change', request, NuclearOptionChangedSchema),
  };
}
