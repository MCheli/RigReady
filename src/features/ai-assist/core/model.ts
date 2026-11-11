import { z } from 'zod';
import { PLACES, ROLES, TIERS } from './pack';

/** What crosses IPC for the binding guide and the AI help. */

export const BoundViewSchema = z.object({
  /** "Stick · Button 3", "Keyboard · LCtrl + G". */
  text: z.string(),
  keyboard: z.boolean(),
  /** On a device marked "not used in DCS": shown, but does not count. */
  ignored: z.boolean(),
  source: z.enum(['user', 'default']),
});

export const ActionViewSchema = z.object({
  actionId: z.string(),
  label: z.string(),
  dcsName: z.string(),
  kind: z.enum(['button', 'axis']),
  editable: z.boolean(),
  bound: z.array(BoundViewSchema),
});

export const ItemViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  tier: z.enum(TIERS),
  place: z.enum(PLACES),
  placeTitle: z.string(),
  role: z.enum(ROLES),
  roleTitle: z.string(),
  need: z.enum(['all', 'any']),
  what: z.string(),
  when: z.string(),
  note: z.string().optional(),
  status: z.enum(['bound', 'partial', 'unbound', 'missing']),
  actions: z.array(ActionViewSchema),
});
export type ItemView = z.infer<typeof ItemViewSchema>;

export const StagedSchema = z.object({
  id: z.string(),
  actionId: z.string(),
  label: z.string(),
  dcsName: z.string(),
  deviceGuid: z.string(),
  deviceName: z.string(),
  input: z.string(),
  inputLabel: z.string(),
});
export type Staged = z.infer<typeof StagedSchema>;

export const StagedViewSchema = StagedSchema.extend({
  replaces: z.array(z.string()),
  clashesWith: z.array(z.string()),
  already: z.boolean(),
});
export type StagedView = z.infer<typeof StagedViewSchema>;

export const ProgressSchema = z.object({
  done: z.array(z.string()).default([]),
  skipped: z.array(z.string()).default([]),
  current: z.string().optional(),
  staged: z.array(StagedSchema).default([]),
});
export type Progress = z.infer<typeof ProgressSchema>;

export const GuideViewSchema = z.object({
  aircraftId: z.string(),
  aircraftName: z.string(),
  guide: z
    .object({
      kind: z.enum(['shipped', 'drafted']),
      summary: z.string(),
      sources: z.array(z.string()),
      drafted: z.object({ by: z.string(), at: z.string() }).optional(),
      roles: z.array(
        z.object({
          role: z.enum(ROLES),
          title: z.string(),
          summary: z.string(),
          items: z.array(z.string()),
        })
      ),
    })
    .nullable(),
  tiers: z.array(
    z.object({ tier: z.enum(TIERS), title: z.string(), items: z.array(ItemViewSchema) })
  ),
  progress: ProgressSchema.omit({ staged: true }),
  staged: z.array(StagedViewSchema),
  controllers: z.array(z.object({ name: z.string(), role: z.string(), guid: z.string() })),
});
export type GuideView = z.infer<typeof GuideViewSchema>;

export const AircraftListSchema = z.object({
  /** False when no game with readable bindings is on this PC. */
  available: z.boolean(),
  gameName: z.string(),
  aircraft: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      hasUserBindings: z.boolean(),
      guide: z.enum(['shipped', 'drafted']).nullable(),
    })
  ),
});
export type AircraftList = z.infer<typeof AircraftListSchema>;

export const PlanSchema = z.object({
  summary: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      action: z.enum(['create', 'change', 'delete', 'rename']),
      to: z.string().optional(),
      title: z.string(),
      lines: z.array(z.string()),
      diff: z.array(z.object({ type: z.enum(['same', 'add', 'del', 'gap']), text: z.string() })),
    })
  ),
  notes: z.array(z.string()),
  blocked: z.string().optional(),
});
export type PlanView = z.infer<typeof PlanSchema>;

export const AppliedSchema = z.object({
  groupId: z.string(),
  summary: z.string(),
  files: z.number().int(),
});
export type AppliedView = z.infer<typeof AppliedSchema>;

export const AiStatusSchema = z.object({
  /** Who answers: anthropic, openai or compatible (any OpenAI-compatible server). */
  provider: z.enum(['anthropic', 'openai', 'compatible']),
  providers: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Fill-ins for the OpenAI-compatible provider. */
  presets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      baseUrl: z.string(),
      model: z.string(),
      structured: z.enum(['schema', 'prompt']),
      keyNeeded: z.boolean(),
      note: z.string(),
    })
  ),
  /** A key is stored for the chosen provider. */
  keyPresent: z.boolean(),
  /** The last four characters only, e.g. "…a1B2". */
  keyHint: z.string().optional(),
  /** False for a server on this PC, which needs no key (one may still be stored). */
  keyNeeded: z.boolean(),
  /** AI help can be used: the provider is set up (and has a key when it needs one). */
  ready: z.boolean(),
  /** Why it cannot be used yet, when it cannot. */
  problem: z.string().optional(),
  model: z.string(),
  /** Models offered in the picker; any other id may be typed. */
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      input: z.number().optional(),
      output: z.number().optional(),
    })
  ),
  /** The OpenAI-compatible provider's address. */
  baseUrl: z.string(),
  structured: z.enum(['schema', 'prompt']),
  /** The only host requests go to; empty while none is set. */
  host: z.string(),
  /** The host is this PC. */
  local: z.boolean(),
  /** Exactly what is and is not sent, one statement per line. */
  whatIsSent: z.array(z.string()),
});
export type AiStatus = z.infer<typeof AiStatusSchema>;

export const UsageSchema = z.object({
  model: z.string(),
  input: z.number(),
  output: z.number(),
  cacheWrite: z.number(),
  cacheRead: z.number(),
  /** Approximate, US dollars; null when the model's price is not known. */
  cost: z.number().nullable(),
});
export type UsageView = z.infer<typeof UsageSchema>;

export const RequestKindSchema = z.enum(['suggest', 'explain', 'ask', 'draft']);
export type RequestKind = z.infer<typeof RequestKindSchema>;

export const PreparedSchema = z.object({
  requestId: z.string(),
  kind: RequestKindSchema,
  model: z.string(),
  /** The exact request body, formatted for reading. The key is a header and is not in it. */
  body: z.string(),
  chars: z.number().int(),
  approxTokens: z.number().int(),
  /** Null when the model's price is not known. */
  approxCost: z.number().nullable(),
  /** Who receives it: "Anthropic", "OpenAI", "the server at localhost:11434". */
  provider: z.string(),
  /** The only host it goes to. */
  host: z.string(),
  /** The host is this PC. */
  local: z.boolean(),
  /**
   * The answer's format is asked for in the text, not enforced by the server: an answer
   * that does not check out is asked for once more with this same request.
   */
  retriesOnce: z.boolean(),
  /** What is in it, in plain words. */
  contents: z.array(z.string()),
  /** The answer arrives as a stream: progress is reported and the request can be cancelled. */
  streamed: z.boolean(),
});
export type Prepared = z.infer<typeof PreparedSchema>;

export const SuggestionViewSchema = z.object({
  id: z.string(),
  actionId: z.string(),
  label: z.string(),
  dcsName: z.string(),
  deviceName: z.string(),
  input: z.string(),
  inputLabel: z.string(),
  priority: z.enum(TIERS),
  reason: z.string(),
  replaces: z.array(z.string()),
  clashesWith: z.array(z.string()),
  already: z.boolean(),
  selected: z.boolean(),
});
export type SuggestionView = z.infer<typeof SuggestionViewSchema>;

export const SentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('suggest'),
    roundId: z.string(),
    summary: z.string(),
    notes: z.array(z.string()),
    suggestions: z.array(SuggestionViewSchema),
    dropped: z.array(z.object({ text: z.string(), why: z.string() })),
    usage: UsageSchema,
  }),
  z.object({
    kind: z.literal('answer'),
    question: z.string(),
    text: z.string(),
    usage: UsageSchema,
  }),
  z.object({
    kind: z.literal('draft'),
    items: z.number().int(),
    dropped: z.number().int(),
    usage: UsageSchema,
  }),
]);
export type Sent = z.infer<typeof SentSchema>;

/** How a streamed request is coming along. Counts only: the answer itself comes when it is complete. */
export const SendProgressSchema = z.object({
  requestId: z.string(),
  /** `started`: the model is working, no text yet. `receiving`: the answer's text is arriving. */
  phase: z.enum(['started', 'receiving']),
  /** Characters of the answer received so far. */
  chars: z.number().int().nonnegative(),
  /** Finished entries of the answer's list (suggestions, guide items) received so far. */
  items: z.number().int().nonnegative(),
});
export type SendProgress = z.infer<typeof SendProgressSchema>;

export const PressSchema = z.object({
  guid: z.string(),
  deviceName: z.string(),
  input: z.string(),
  label: z.string(),
  kind: z.enum(['button', 'hat', 'axis']),
});
