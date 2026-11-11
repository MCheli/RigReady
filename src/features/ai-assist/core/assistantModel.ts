import { z } from 'zod';

/**
 * What crosses IPC for the built-in assistant, the program finder and the drafts: the
 * schemas alone, with nothing that needs Node, so the contract and the pages can import them.
 */

// ---- programs ------------------------------------------------------------

export const FindProgramsInputSchema = z.object({
  names: z
    .array(z.string().trim().min(2).max(60))
    .min(1)
    .max(10)
    .describe(
      'Program names, vendors or exe names to look for: "SimAppPro", "TrackIR", "SRS", "Stream Deck", "VoiceAttack", "Tacview", "OpenKneeboard", "Pit House", "G HUB".'
    ),
});

export type FindProgramsInput = z.infer<typeof FindProgramsInputSchema>;

export const FoundProgramSchema = z.object({
  /** The exe's file name: "TrackIR5.exe". */
  exe: z.string(),
  /** Where it is, in stored form: "{PROGRAM_FILES_X86}/TrackIR5/TrackIR5.exe". */
  path: z.string(),
  /** Where it was found: "Program Files (x86)", "Uninstall entry: TrackIR5". */
  where: z.string(),
  /** Which of the names asked for it matched. */
  matched: z.string(),
  /** The exe's own name contains what was asked for: most likely the program itself. */
  likely: z.boolean(),
  product: z.string().optional(),
  publisher: z.string().optional(),
  version: z.string().optional(),
});

export type FoundProgram = z.infer<typeof FoundProgramSchema>;

export const FoundProgramsSchema = z.object({
  programs: z.array(FoundProgramSchema),
  /** The folders that were looked in, in stored form. */
  searched: z.array(z.string()),
  /** Names nothing was found for. */
  notFound: z.array(z.string()),
  /** More was found than is listed. */
  truncated: z.boolean(),
});

export type FoundPrograms = z.infer<typeof FoundProgramsSchema>;

// ---- drafts ------------------------------------------------------------

export const Params = z.record(z.string(), z.unknown()).default({});

export const ProposedCheckSchema = z.object({
  type: z.string().min(1).max(60).describe('A check type from profiles:types ("process.running").'),
  title: z.string().trim().min(1).max(120),
  required: z.boolean().default(true),
  params: Params,
  remediation: z
    .object({ type: z.string().min(1).max(60), params: Params })
    .optional()
    .describe('The fix Make ready runs ("process.launch" with the exe), from profiles:types.'),
});

export const ProposedStepSchema = z.object({
  phase: z.enum(['preLaunch', 'postLaunch', 'standDown']),
  type: z
    .string()
    .min(1)
    .max(60)
    .describe('A fix type from profiles:types ("process.launch", "script.run").'),
  title: z.string().trim().min(1).max(120),
  params: Params,
  continueOnError: z.boolean().default(true),
  delaySeconds: z.number().int().min(0).max(3600).default(0),
});

export const ProposeSetupInputSchema = z.object({
  setup: z
    .string()
    .max(120)
    .optional()
    .describe('An existing setup to add to, by id or name. Left out: a new setup.'),
  newSetup: z
    .object({
      name: z.string().trim().min(1).max(80),
      game: z.string().max(40).optional().describe('A game module id ("dcs", "iracing").'),
    })
    .optional()
    .describe(
      'For a new setup: its name and game. What Launch starts is chosen by the user in the setup editor.'
    ),
  summary: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe('What the change does and why, for the user.'),
  addChecks: z.array(ProposedCheckSchema).max(30).default([]),
  addSteps: z.array(ProposedStepSchema).max(20).default([]),
});

export type ProposeSetupInput = z.infer<typeof ProposeSetupInputSchema>;

export const ScriptUseSchema = z.object({
  setup: z.string().max(120).describe('The setup the script is for, by id or name.'),
  as: z
    .enum(['check', 'fix', 'preLaunch', 'postLaunch', 'standDown'])
    .describe('A check of its own, the fix of an existing check, or a step around the launch.'),
  title: z.string().trim().min(1).max(120),
  forCheck: z
    .string()
    .max(120)
    .optional()
    .describe('For "fix": the check it fixes, by id or title.'),
  args: z.array(z.string().max(400)).max(40).default([]),
  timeoutSeconds: z.number().int().min(1).max(600).optional(),
});

export const DraftScriptInputSchema = z.object({
  fileName: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,47}\.(ps1|cmd)$/)
    .describe('Lower-case words joined by hyphens, ending .ps1 or .cmd: "srs-running.ps1".'),
  content: z.string().min(1).max(20_000).describe('The whole script.'),
  explanation: z
    .string()
    .trim()
    .min(20)
    .max(4000)
    .describe('What the script does, line by line where it matters, in plain words for the user.'),
  use: ScriptUseSchema.optional().describe('Where the script goes in a setup, when it is saved.'),
});

export type DraftScriptInput = z.infer<typeof DraftScriptInputSchema>;

export const LineSchema = z.object({ title: z.string(), type: z.string(), detail: z.string() });

export const SetupDraftViewSchema = z.object({
  id: z.string(),
  by: z.string(),
  at: z.string(),
  summary: z.string(),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('new'), name: z.string(), game: z.string().optional() }),
    z.object({ kind: z.literal('existing'), id: z.string(), name: z.string() }),
  ]),
  checks: z.array(LineSchema.extend({ required: z.boolean(), fix: z.string().optional() })),
  steps: z.array(LineSchema.extend({ phase: z.string() })),
  /** The setup as it would be saved, as YAML-like JSON, for "show exactly". */
  exact: z.string(),
});

export type SetupDraftView = z.infer<typeof SetupDraftViewSchema>;

export const ScriptDraftViewSchema = z.object({
  id: z.string(),
  by: z.string(),
  at: z.string(),
  fileName: z.string(),
  /** Where it is saved, in stored form. */
  stored: z.string(),
  /** Exactly what is written: the header and the script. */
  text: z.string(),
  explanation: z.string(),
  /** Things worth a second look ("downloads from the internet"). */
  warnings: z.array(z.string()),
  /** A file of this name is there already and would be replaced. */
  replaces: z.boolean(),
  use: ScriptUseSchema.optional(),
});

export type ScriptDraftView = z.infer<typeof ScriptDraftViewSchema>;

export const DraftsSchema = z.object({
  setups: z.array(SetupDraftViewSchema),
  scripts: z.array(ScriptDraftViewSchema),
});

export type Drafts = z.infer<typeof DraftsSchema>;

export const SavedScriptSchema = z.object({
  file: z.string(),
  stored: z.string(),
  state: z.enum(['approved', 'changed', 'unapproved']),
  /** What is in the file now. */
  text: z.string(),
  sha256: z.string(),
  approvedAt: z.string().optional(),
  draftedBy: z.string().optional(),
  explanation: z.string().optional(),
});

export type SavedScript = z.infer<typeof SavedScriptSchema>;

// ---- assistant ------------------------------------------------------------

export const EntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), text: z.string() }),
  z.object({ kind: z.literal('assistant'), text: z.string() }),
  z.object({
    kind: z.literal('tool'),
    tool: z.string(),
    title: z.string(),
    tier: z.enum(['read', 'change', 'launch', 'off']),
    ok: z.boolean(),
    /** One line: what it answered, or why it did not run. */
    line: z.string(),
  }),
  z.object({ kind: z.literal('note'), text: z.string() }),
]);

export type Entry = z.infer<typeof EntrySchema>;

export const TurnPreviewSchema = z.object({
  requestId: z.string(),
  conversationId: z.string(),
  model: z.string(),
  /** Who answers and the one host the request goes to: "Anthropic (api.anthropic.com)". */
  to: z.string(),
  /** True for a server on this PC. */
  local: z.boolean(),
  /** The exact JSON body, formatted. */
  body: z.string(),
  chars: z.number().int(),
  approxTokens: z.number().int(),
  /** Dollars to read it, when the model's price is known. */
  approxCost: z.number().nullable(),
  /** What the request carries, in a line each. */
  contents: z.array(z.string()),
});

export type TurnPreview = z.infer<typeof TurnPreviewSchema>;

export const ConversationViewSchema = z.object({
  conversationId: z.string(),
  entries: z.array(EntrySchema),
  /** Tokens as the provider reported them; the cost only where the price is known. */
  usage: z.object({ input: z.number(), output: z.number(), cost: z.number().nullable() }),
  /** Tool results are waiting to be sent with the next request. */
  waiting: z.boolean(),
});

export type ConversationView = z.infer<typeof ConversationViewSchema>;

export const TurnOutcomeSchema = z.object({
  conversation: ConversationViewSchema,
  /** The next request, when the model used tools and wants to go on. */
  next: TurnPreviewSchema.optional(),
});

export type TurnOutcome = z.infer<typeof TurnOutcomeSchema>;
