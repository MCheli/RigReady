import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import {
  AiStatusSchema,
  AircraftListSchema,
  AppliedSchema,
  GuideViewSchema,
  MonthBudgetSchema,
  PlanSchema,
  PreparedSchema,
  PressSchema,
  PriceSchema,
  ProgressSchema,
  SendProgressSchema,
  RequestKindSchema,
  SentSchema,
} from './core/model';
import {
  FindProgramsInputSchema,
  FoundProgramsSchema,
  ProposeSetupInputSchema,
  DraftScriptInputSchema,
  DraftsSchema,
  SavedScriptSchema,
  TurnPreviewSchema,
  ConversationViewSchema,
  TurnOutcomeSchema,
  AssistantProgressSchema,
} from './core/assistantModel';

const By = z.string().trim().min(1).max(80).default('An assistant');
const DraftId = z.object({ draftId: z.string().max(40) });
const ConversationId = z.object({ conversationId: z.string().max(40) });

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
      describe:
        "Deletes the binding guide an AI drafted for one aircraft in RigReady's data folder. A copy is kept and Undo is on the Safety page. A guide the user wrote or imported is refused: only the user deletes that, in RigReady's window.",
      tier: 'change',
    }),
    /** The window's Delete, after the user said yes: whichever guide is kept, the user's own included. */
    deleteGuide: channel(Aircraft, z.object({ deleted: z.boolean() }), {
      describe:
        "Deletes the binding guide file kept for one aircraft, the user's own included, after the user said yes in RigReady's window. Only a window of the app does this.",
      tier: 'off',
    }),
    importGuide: channel(Aircraft, z.object({ imported: z.boolean(), items: z.number().int() }), {
      describe:
        "Asks the user for a binding guide file in the Windows file dialog, checks it and copies it into RigReady's data folder for one aircraft. Only a window of the app does this.",
      tier: 'off',
    }),
    startOwnGuide: channel(Aircraft, z.object({ started: z.boolean() }), {
      describe:
        "Writes a short starter binding guide for one aircraft into RigReady's data folder, for the user to edit. Only a window of the app does this.",
      tier: 'off',
    }),
    openGuideFile: channel(Aircraft, z.object({ opened: z.boolean() }), {
      describe: 'Opens the binding guide file kept for one aircraft in Notepad.',
      tier: 'off',
    }),

    // ---------------------------------------------------------------------------------
    // The built-in assistant: a conversation, its requests (shown first), drafts, scripts
    // ---------------------------------------------------------------------------------

    /** Builds the request for a message of the user and returns exactly what would be sent. */
    assistantPrepare: channel(
      z.object({
        conversationId: z.string().max(40).optional(),
        text: z.string().max(4000),
      }),
      TurnPreviewSchema,
      {
        describe: 'Builds a request of the built-in assistant and shows what would be sent.',
        tier: 'off',
      }
    ),
    /**
     * Sends a prepared request; the tools the model asks for run through the gate. A request
     * that would take the question past the ceiling is refused (ai.ceiling) and kept, until
     * the user says to go on: `pastCeiling`.
     */
    assistantSend: channel(
      z.object({ requestId: z.string().max(40), pastCeiling: z.boolean().optional() }),
      TurnOutcomeSchema,
      {
        describe: 'Sends a prepared request of the built-in assistant to the chosen AI provider.',
        tier: 'off',
      }
    ),
    /** Builds the next request again from what the tools answered, after one was lost or refused. */
    assistantResume: channel(ConversationId, TurnPreviewSchema, {
      describe:
        'Builds the waiting request of a conversation of the built-in assistant again. Nothing is sent.',
      tier: 'off',
    }),
    /** Throws a prepared request away without sending it. */
    assistantDiscard: channel(
      z.object({ requestId: z.string().max(40) }),
      z.object({ discarded: z.boolean() }),
      { describe: 'Throws away a request of the built-in assistant unsent.', tier: 'off' }
    ),
    /** Stops the assistant while it works: the request in flight ends, no further tool runs. */
    assistantStop: channel(ConversationId, z.object({ stopped: z.boolean() }), {
      describe: 'Stops the built-in assistant while it is working on a question.',
      tier: 'off',
    }),
    assistantConversation: channel(ConversationId, ConversationViewSchema, {
      describe: 'One conversation of the built-in assistant.',
      tier: 'off',
    }),
    assistantForget: channel(ConversationId, z.object({ forgotten: z.boolean() }), {
      describe: 'Ends a conversation of the built-in assistant.',
      tier: 'off',
    }),
    /**
     * The most one question to the assistant may reach by RigReady's estimate before it stops
     * and asks; 0 for none. Turning it on needs `acknowledged`: the user's own yes that the
     * limit is counted from estimates and is not the provider's bill.
     */
    setQuestionCeiling: channel(
      z.object({ dollars: z.number().min(0).max(1000), acknowledged: z.boolean().default(false) }),
      AiStatusSchema,
      {
        describe:
          "Sets the most one question to the built-in assistant may reach, by RigReady's estimate, before RigReady stops and asks. Turning it on needs the user's acknowledgement that it is counted from estimates.",
        tier: 'off',
      }
    ),
    /**
     * The most a calendar month may reach by RigReady's estimate before nothing more is sent;
     * 0 for none. Turning it on needs `acknowledged`, as the ceiling does.
     */
    setMonthlyBudget: channel(
      z.object({
        dollars: z.number().min(0).max(1_000_000),
        acknowledged: z.boolean().default(false),
      }),
      AiStatusSchema,
      {
        describe:
          "Sets the monthly budget: the most a calendar month's requests may reach, by RigReady's estimate, before RigReady stops sending. Turning it on needs the user's acknowledgement that it is counted from estimates.",
        tier: 'off',
      }
    ),
    /** The user's own prices for the chosen model, in US dollars per million tokens. */
    setPrices: channel(PriceSchema, AiStatusSchema, {
      describe:
        "Sets the user's own prices for the chosen model, in US dollars per million tokens: input, output, cache read and cache write. Every estimate for that model uses them from then on.",
      tier: 'off',
    }),
    /** Forgets the user's own prices for the chosen model: the built-in ones, or none, again. */
    resetPrices: channel(noInput, AiStatusSchema, {
      describe:
        "Removes the user's own prices for the chosen model, so estimates use RigReady's built-in prices again, or none where it has none.",
      tier: 'off',
    }),
    /** Where helper programs are installed, by name or vendor. Reads folder names and the registry only. */
    findPrograms: channel(FindProgramsInputSchema, FoundProgramsSchema, {
      describe:
        'Finds where programs are installed, by name or vendor (SimAppPro, TrackIR, SRS, Stream Deck, VoiceAttack, Tacview, OpenKneeboard, Pit House, G HUB): Program Files, Program Files (x86), the Programs folder of LocalAppData, the Steam libraries and the uninstall entries of the registry. Paths come back with path variables, ready for a setup. Changes nothing.',
      tier: 'read',
    }),
    /** A draft of changes to a setup, shown in RigReady; saved only by the user. */
    proposeSetup: channel(
      ProposeSetupInputSchema.extend({ by: By }),
      z.object({ draftId: z.string(), message: z.string() }),
      {
        describe:
          'Proposes checks and launch steps for a setup, or a new setup. The proposal is shown to the user in RigReady and nothing is saved until they press Save there.',
        tier: 'read',
      }
    ),
    /** A draft script and its explanation, shown in RigReady; saved only by the user. */
    draftScript: channel(
      DraftScriptInputSchema.extend({ by: By }),
      z.object({ draftId: z.string(), message: z.string() }),
      {
        describe:
          'Drafts a script (.ps1 or .cmd) for a check, a fix or a launch step, with a plain explanation. The user reads it in RigReady; it is saved only when they press Save, and it never runs without asking them.',
        tier: 'read',
      }
    ),
    /** The drafts waiting for the user. */
    drafts: channel(noInput, DraftsSchema, {
      describe: 'The setup proposals and script drafts waiting for the user in RigReady.',
      tier: 'read',
    }),
    saveSetupDraft: channel(
      DraftId,
      z.object({ setupId: z.string(), name: z.string(), message: z.string() }),
      {
        describe: 'The user saves a setup proposal. Only a window of the app does this.',
        tier: 'off',
      }
    ),
    saveScriptDraft: channel(
      DraftId,
      z.object({
        file: z.string(),
        stored: z.string(),
        sha256: z.string(),
        message: z.string(),
        setupId: z.string().optional(),
      }),
      {
        describe: 'The user saves a script draft. Only a window of the app does this.',
        tier: 'off',
      }
    ),
    discardDraft: channel(DraftId, z.object({ discarded: z.boolean() }), {
      describe: 'The user throws a draft away. Only a window of the app does this.',
      tier: 'off',
    }),
    /** The scripts assistants wrote, with whether each is still as approved. */
    assistantScripts: channel(noInput, z.object({ scripts: z.array(SavedScriptSchema) }), {
      describe:
        'The scripts assistants wrote and the user saved, each with its text and whether it is still exactly as the user approved it.',
      tier: 'read',
    }),
    /** The user approves a script again, as the window showed it (by its hash). */
    approveScript: channel(
      z.object({
        file: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}\.(ps1|cmd)$/i),
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
      }),
      SavedScriptSchema,
      {
        describe: 'The user approves a changed script again. Only a window of the app does this.',
        tier: 'off',
      }
    ),
  },
  {
    pressed: PressSchema,
    /** A draft of an assistant came, was saved or was thrown away; a script was approved. */
    draftsChanged: z.object({}),
    /** A request that is being answered got further. */
    sendProgress: SendProgressSchema,
    /** The assistant got further with a question: what it is doing and what it is estimated at. */
    assistantProgress: AssistantProgressSchema,
    /** The provider, model, key, prices, ceiling or budget changed: `status` is worth asking again. */
    settingsChanged: z.object({}),
    /** A request was answered and counted: what this month is estimated at now. */
    monthChanged: MonthBudgetSchema,
  }
);
