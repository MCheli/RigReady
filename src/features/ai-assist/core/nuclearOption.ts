import { z } from 'zod';
import { err, ok, type Result } from '../../../core/result';
import { ChangePreviewSchema } from '../../../shared/changePreview';
import type { Envelope } from '../../../shared/ipc';

/**
 * The binding guide for Nuclear Option. The game has one set of bindings for every aircraft,
 * so there is one guide. What is bound is read through the bindings registry, like DCS's; a
 * button, an axis or a key is bound through the Nuclear Option bindings feature's change channels,
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
 * What the guide binds here: every action the bindings feature offers, by the id its
 * bindings carry: a button action ("11"), an axis action as a whole ("25"), and one side of
 * an axis action ("25:+", "25:-").
 */
export const bindsHere = (action: { id: string }): boolean => /^\d+(:[+-])?$/.test(action.id);

/** The game's action id and, for one side of an axis action, the side, from a binding id. */
export function actionAndSide(id: string): { actionId: number; side?: '+' | '-' } | undefined {
  const parts = /^(\d+)(?::([+-]))?$/.exec(id);
  if (!parts) return undefined;
  return { actionId: Number(parts[1]), ...(parts[2] ? { side: parts[2] as '+' | '-' } : {}) };
}

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

/**
 * What the user just used for a binding: a button of a controller (the first is 1), an axis
 * of a controller by the name it reports ("X", "RZ"), or a key by the browser's name for it.
 * A controller is known by its DirectInput instance GUID, as a press gives it.
 */
export const NuclearOptionWantedSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('button'),
    device: z.string().min(1).max(64),
    button: z.number().int().min(1).max(128),
  }),
  z.object({
    kind: z.literal('axis'),
    device: z.string().min(1).max(64),
    axis: z.string().min(1).max(40),
    invert: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('key'),
    code: z.string().min(1).max(40),
    ctrl: z.boolean().default(false),
    alt: z.boolean().default(false),
    shift: z.boolean().default(false),
  }),
]);
export type NuclearOptionWanted = z.infer<typeof NuclearOptionWantedSchema>;

/** A change as the bindings feature takes it: exactly one of button, axis and key. */
export interface NuclearOptionRequest {
  /** The controller by the bindings feature's own id, or "keyboard". */
  device: string;
  actionId: number;
  side?: '+' | '-';
  button?: number;
  axis?: { name: string; invert: boolean };
  key?: { code: string; ctrl: boolean; alt: boolean; shift: boolean };
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
