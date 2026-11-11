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
  SendProgressSchema,
  RequestKindSchema,
  SentSchema,
} from './core/model';

const Aircraft = z.object({ aircraftId: z.string().min(1).max(200) });
const Round = z.object({ roundId: z.string(), selected: z.array(z.string()).max(200) });

export const aiAssistContract = defineContract(
  'ai-assist',
  {
    /** The aircraft DCS has bindings for, and which have a guide. */
    aircraft: channel(noInput, AircraftListSchema, {
      describe:
        'The aircraft DCS has bindings for, and which have a binding guide. Aircraft ids here are what the other ai-assist channels take.',
      tier: 'read',
    }),
    /** The guide for one aircraft with what is bound now, progress and staged changes. */
    guide: channel(Aircraft, GuideViewSchema, {
      describe:
        'The binding guide for one aircraft with what is bound now, progress and staged changes. aircraftId comes from ai-assist:aircraft.',
      tier: 'read',
    }),
    setProgress: channel(
      Aircraft.extend({
        itemId: z.string(),
        state: z.enum(['done', 'skipped', 'open']),
        current: z.string().optional(),
      }),
      ProgressSchema,
      {
        describe:
          "Marks one guide item done, skipped or open. Only the guide's progress is kept; no bindings are written.",
        tier: 'read',
      }
    ),
    setCurrent: channel(Aircraft.extend({ itemId: z.string() }), ProgressSchema, {
      describe: "Moves the guide to one item. Only the guide's progress is kept.",
      tier: 'read',
    }),
    resetProgress: channel(Aircraft, ProgressSchema, {
      describe: "Clears the guide's progress for one aircraft. No bindings are written.",
      tier: 'read',
    }),
    /** Stages binding an action to a control. Nothing is written. */
    stage: channel(
      Aircraft.extend({ actionId: z.string(), deviceGuid: z.string(), input: z.string().max(40) }),
      GuideViewSchema,
      {
        describe:
          'Stages binding an action from the guide to a control (deviceGuid and input). Nothing is written until applyStaged.',
        tier: 'read',
      }
    ),
    /** Removes one staged change, or all of them when no id is given. */
    unstage: channel(Aircraft.extend({ id: z.string().optional() }), GuideViewSchema, {
      describe:
        'Removes one staged change, or all of them when no id is given. Nothing is written.',
      tier: 'read',
    }),
    /** Exactly what the staged changes would write. Nothing is written. */
    reviewStaged: channel(Aircraft, PlanSchema, {
      describe:
        'Exactly what the staged changes would write to the DCS bindings. Call it before applyStaged and show the user.',
      tier: 'read',
    }),
    /** Writes the staged changes as one undoable change, through the bindings feature. */
    applyStaged: channel(Aircraft, AppliedSchema, {
      describe:
        'Writes the staged changes to the DCS bindings as one change. Call reviewStaged first and show the user. Undo is on the Safety page.',
      tier: 'change',
    }),
    undo: channel(z.object({ groupId: z.string() }), z.object({ undone: z.boolean() }), {
      describe:
        'Undoes bindings written from the guide. groupId comes from the applyStaged result or safety:journal.',
      tier: 'change',
    }),
    /** Starts reporting presses on any controller as `pressed` events. */
    listenStart: channel(noInput, z.object({ listening: z.boolean() }), {
      describe: 'Starts reporting presses on any controller to the page.',
      tier: 'off',
    }),
    listenStop: channel(noInput, z.object({ listening: z.boolean() }), {
      describe: 'Stops reporting controller presses.',
      tier: 'off',
    }),

    /** The provider, whether a key is stored (its last four characters only), the model, what is sent. */
    status: channel(noInput, AiStatusSchema, {
      describe:
        'Which AI provider answers (Anthropic, OpenAI or an OpenAI-compatible server), whether a key is stored (its last four characters only), the model, and what is sent.',
      tier: 'read',
    }),
    setProvider: channel(
      z.object({ provider: z.enum(['anthropic', 'openai', 'compatible']) }),
      AiStatusSchema,
      { describe: 'Chooses who answers the AI requests.', tier: 'off' }
    ),
    setModel: channel(z.object({ model: z.string().max(200) }), AiStatusSchema, {
      describe: 'Chooses the model of the chosen AI provider. Any model id may be typed.',
      tier: 'off',
    }),
    /** The OpenAI-compatible provider: a preset, its address, or how answers are kept to JSON. */
    setCompatible: channel(
      z.object({
        preset: z.string().max(40).optional(),
        baseUrl: z.string().max(400).optional(),
        structured: z.enum(['schema', 'prompt']).optional(),
      }),
      AiStatusSchema,
      {
        describe:
          'Sets up the OpenAI-compatible provider: a preset, the API address, or whether answers are kept to JSON by a schema or by asking.',
        tier: 'off',
      }
    ),
    /** Stores the chosen provider's key, encrypted for this Windows user. It is never sent back. */
    setKey: channel(z.object({ key: z.string().max(400) }), AiStatusSchema, {
      describe: "Stores the chosen AI provider's API key, encrypted for this Windows user.",
      tier: 'off',
    }),
    clearKey: channel(noInput, AiStatusSchema, {
      describe: "Removes the chosen AI provider's stored API key.",
      tier: 'off',
    }),
    /** One small request that only succeeds with a working key, address and model. */
    testKey: channel(noInput, z.object({ valid: z.boolean(), message: z.string() }), {
      describe: 'Sends one small request to check the chosen AI provider, its key and model.',
      tier: 'off',
    }),
    /** Builds a request and returns exactly what would be sent. Nothing is sent. */
    prepare: channel(
      Aircraft.extend({
        kind: RequestKindSchema,
        question: z.string().max(2000).optional(),
        actionId: z.string().optional(),
      }),
      PreparedSchema,
      { describe: 'Builds a request to the AI and shows exactly what would be sent.', tier: 'off' }
    ),
    /** Sends a prepared request, unchanged. */
    send: channel(z.object({ requestId: z.string() }), SentSchema, {
      describe: 'Sends a prepared request to the chosen AI provider.',
      tier: 'off',
    }),
    /** Stops a request that is being answered. Nothing of its answer is used. */
    cancel: channel(
      z.object({ requestId: z.string().max(40) }),
      z.object({ cancelled: z.boolean() }),
      { describe: 'Stops a request that is being answered.', tier: 'off' }
    ),
    reviewSuggestions: channel(Round, PlanSchema, {
      describe:
        'What the chosen AI suggestions of one round would write to the DCS bindings. roundId and suggestion ids come from an AI answer. Call it before applySuggestions.',
      tier: 'read',
    }),
    applySuggestions: channel(Round, AppliedSchema, {
      describe:
        'Writes the chosen AI suggestions of one round to the DCS bindings as one change. Call reviewSuggestions first and show the user. Undo is on the Safety page.',
      tier: 'change',
    }),
    deleteDraft: channel(Aircraft, z.object({ deleted: z.boolean() }), {
      describe: 'Deletes the binding guide the AI drafted for one aircraft.',
      tier: 'change',
    }),
  },
  {
    pressed: PressSchema,
    /** A request that is being answered got further. */
    sendProgress: SendProgressSchema,
    /** The settings changed (the API key was stored or removed): `status` is worth asking again. */
    settingsChanged: z.object({}),
  }
);
