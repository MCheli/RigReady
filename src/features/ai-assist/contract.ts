import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import {
  AiStatusSchema,
  AircraftListSchema,
  AppliedSchema,
  GuideViewSchema,
  PlanSchema,
  PreparedSchema,
  PressSchema,
  ProgressSchema,
  RequestKindSchema,
  SentSchema,
} from './core/model';

const Aircraft = z.object({ aircraftId: z.string().min(1).max(200) });
const Round = z.object({ roundId: z.string(), selected: z.array(z.string()).max(200) });

export const aiAssistContract = defineContract(
  'ai-assist',
  {
    /** The aircraft DCS has bindings for, and which have a guide. */
    aircraft: channel(noInput, AircraftListSchema),
    /** The guide for one aircraft with what is bound now, progress and staged changes. */
    guide: channel(Aircraft, GuideViewSchema),
    setProgress: channel(
      Aircraft.extend({
        itemId: z.string(),
        state: z.enum(['done', 'skipped', 'open']),
        current: z.string().optional(),
      }),
      ProgressSchema
    ),
    setCurrent: channel(Aircraft.extend({ itemId: z.string() }), ProgressSchema),
    resetProgress: channel(Aircraft, ProgressSchema),
    /** Stages binding an action to a control. Nothing is written. */
    stage: channel(
      Aircraft.extend({ actionId: z.string(), deviceGuid: z.string(), input: z.string().max(40) }),
      GuideViewSchema
    ),
    /** Removes one staged change, or all of them when no id is given. */
    unstage: channel(Aircraft.extend({ id: z.string().optional() }), GuideViewSchema),
    /** Exactly what the staged changes would write. Nothing is written. */
    reviewStaged: channel(Aircraft, PlanSchema),
    /** Writes the staged changes as one undoable change, through the bindings feature. */
    applyStaged: channel(Aircraft, AppliedSchema),
    undo: channel(z.object({ groupId: z.string() }), z.object({ undone: z.boolean() })),
    /** Starts reporting presses on any controller as `pressed` events. */
    listenStart: channel(noInput, z.object({ listening: z.boolean() })),
    listenStop: channel(noInput, z.object({ listening: z.boolean() })),

    /** Whether a key is stored (its last four characters only), the model, what is sent. */
    status: channel(noInput, AiStatusSchema),
    setModel: channel(z.object({ model: z.string() }), AiStatusSchema),
    /** One free request that only succeeds with a valid key. */
    testKey: channel(noInput, z.object({ valid: z.boolean(), message: z.string() })),
    /** Builds a request and returns exactly what would be sent. Nothing is sent. */
    prepare: channel(
      Aircraft.extend({
        kind: RequestKindSchema,
        question: z.string().max(2000).optional(),
        actionId: z.string().optional(),
      }),
      PreparedSchema
    ),
    /** Sends a prepared request, unchanged. */
    send: channel(z.object({ requestId: z.string() }), SentSchema),
    reviewSuggestions: channel(Round, PlanSchema),
    applySuggestions: channel(Round, AppliedSchema),
    deleteDraft: channel(Aircraft, z.object({ deleted: z.boolean() })),
  },
  {
    pressed: PressSchema,
    /** The settings changed (the API key was stored or removed): `status` is worth asking again. */
    settingsChanged: z.object({}),
  }
);
