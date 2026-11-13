import { z } from 'zod';
import { ChangePreviewSchema } from '../../../shared/changePreview';
import { GUIDE_GAMES, PLACES, ROLES, TIERS } from './pack';

export const GuideGameSchema = z.enum(GUIDE_GAMES);

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
  /** inGame: not bound, and only the game itself can bind it (an iRacing axis). */
  status: z.enum(['bound', 'partial', 'unbound', 'inGame', 'missing']),
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
  /** dcs: an aircraft. iracing: a class of car, or a car with controls of its own. */
  game: GuideGameSchema.default('dcs'),
  aircraftId: z.string(),
  aircraftName: z.string(),
  guide: z
    .object({
      /** shipped with RigReady, drafted by AI, or the user's own (imported or written by hand). */
      kind: z.enum(['shipped', 'drafted', 'own']),
      summary: z.string(),
      sources: z.array(z.string()),
      drafted: z.object({ by: z.string(), at: z.string() }).optional(),
      /**
       * An iRacing car without a guide of its own uses a class guide when its folder name says
       * the class: the class, and the part of the name that says so.
       */
      suggested: z.object({ className: z.string(), token: z.string() }).optional(),
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
  /**
   * The guide file kept for this aircraft in RigReady's data folder, when there is one: a
   * draft or the user's own. `problem` says what is wrong with a file that cannot be used.
   */
  stored: z.object({ problem: z.string().optional() }).nullable(),
  tiers: z.array(
    z.object({ tier: z.enum(TIERS), title: z.string(), items: z.array(ItemViewSchema) })
  ),
  progress: ProgressSchema.omit({ staged: true }),
  staged: z.array(StagedViewSchema),
  controllers: z.array(z.object({ name: z.string(), role: z.string(), guid: z.string() })),
  /** For iRacing: the bindings this is about, and whether RigReady may change them now. */
  iracing: z
    .object({
      /** The iRacing bindings page's id of those bindings: "all", or "car:<folder>". */
      set: z.string(),
      /** "All cars", or the car's folder name. */
      setName: z.string(),
      /** The control profile those bindings are in, when iRacing keeps profiles. */
      profile: z.string().optional(),
      /** The simulator runs, so nothing is written until it closes. */
      simRunning: z.boolean(),
      notes: z.array(z.string()),
    })
    .optional(),
});
export type GuideView = z.infer<typeof GuideViewSchema>;

/** The games the guide has guides for, and whether each is on this PC. */
export const GuideGamesSchema = z.object({
  games: z.array(z.object({ id: GuideGameSchema, name: z.string(), available: z.boolean() })),
});
export type GuideGames = z.infer<typeof GuideGamesSchema>;

export const AircraftListSchema = z.object({
  game: GuideGameSchema.default('dcs'),
  /** False when the game, or its bindings, are not on this PC. */
  available: z.boolean(),
  gameName: z.string(),
  aircraft: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      hasUserBindings: z.boolean(),
      guide: z.enum(['shipped', 'drafted', 'own']).nullable(),
      /** An iRacing car that uses a class guide: the class's name. */
      uses: z.string().optional(),
    })
  ),
});
export type AircraftList = z.infer<typeof AircraftListSchema>;

/** One iRacing binding as it would change, from the iRacing bindings feature's preview. */
export const IracingReviewViewSchema = z.object({
  actionId: z.string(),
  label: z.string(),
  /** Every car the change applies to: "All cars", "porsche992rgt3 only", or a shared profile's cars. */
  forCars: z.string(),
  before: z.string(),
  after: z.string(),
  /** Saving would change nothing: the action has exactly this already. */
  same: z.boolean(),
  /** What else the same button or key does in that set, by plain label. */
  conflicts: z.array(z.object({ id: z.string(), name: z.string(), cameraEditor: z.boolean() })),
  blocked: z.string().optional(),
  preview: ChangePreviewSchema,
  /** The file as the preview read it: handed back to bind, which refuses a file that changed. */
  seen: z.string(),
});
export type IracingReviewView = z.infer<typeof IracingReviewViewSchema>;

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

/**
 * Dollars one question to the assistant may cost before RigReady stops and asks, until the
 * user sets their own in Settings. 0 means no ceiling.
 */
export const DEFAULT_QUESTION_CEILING = 0.25;
export const MAX_QUESTION_CEILING = 50;

/**
 * Dollars a calendar month may reach by RigReady's estimate before it stops sending. 0 means
 * no budget, which is how it starts: a budget is the user's own, set with an acknowledgement.
 */
export const DEFAULT_MONTHLY_BUDGET = 0;
export const MAX_MONTHLY_BUDGET = 10_000;
/** The share of the monthly budget from which RigReady warns. */
export const BUDGET_WARN_SHARE = 0.8;

/**
 * When RigReady's built-in prices (anthropic.ts, providers.ts) were recorded from the
 * providers' published price lists. Shown with every estimate that uses them: change it
 * whenever a price in those tables is changed.
 */
export const PRICES_RECORDED = 'November 2026';
export const MAX_PRICE = 10_000;

const PerMillion = z.number().min(0).max(MAX_PRICE);
/** What a model costs, in US dollars per million tokens. */
export const PriceSchema = z.object({
  /** Input read fresh. */
  input: PerMillion,
  output: PerMillion,
  /** Input the provider reads from its cache. */
  cacheRead: PerMillion,
  /** Input the provider writes to its cache. */
  cacheWrite: PerMillion,
});
export type Price = z.infer<typeof PriceSchema>;

/** The prices an estimate is worked out from: RigReady's built-in ones, or the user's own numbers. */
export const PriceBasisSchema = PriceSchema.extend({ source: z.enum(['built-in', 'own']) });
export type PriceBasis = z.infer<typeof PriceBasisSchema>;

/**
 * Where the prices behind a dollar estimate come from. `mixed` is a sum over requests that
 * were not all estimated at the same prices. No dollar figure is shown without one.
 */
export const PriceSourceSchema = z.enum(['built-in', 'own', 'mixed']);
export type PriceSource = z.infer<typeof PriceSourceSchema>;

/** A calendar month of estimates against the monthly budget. */
export const MonthBudgetSchema = z.object({
  /** Dollars the month may reach by RigReady's estimate before it stops sending; 0 for no budget. */
  budget: z.number(),
  /** The month counted, by this PC's clock: "2026-11". */
  month: z.string(),
  /**
   * RigReady's estimate of the month's answered requests, each at the prices in force when
   * it was sent. An estimate, never what the provider charged.
   */
  spent: z.number(),
  /** Answered requests in that estimate. */
  requests: z.number().int(),
  /** Answered requests of the month that had no prices: they are in no estimate. */
  unpriced: z.number().int(),
  /**
   * off: no budget. ok. warn: at or past the warning share. stopped: the estimate has reached
   * the budget, or the request asked about would take it past, so nothing is sent.
   */
  state: z.enum(['off', 'ok', 'warn', 'stopped']),
  /** The count could not be read, and why: with a budget set nothing is sent until it can. */
  problem: z.string().optional(),
});
export type MonthBudget = z.infer<typeof MonthBudgetSchema>;

/**
 * The limits counted from estimates, and when the user acknowledged what each one is (an ISO
 * time). Turning one on needs that acknowledgement.
 */
export const AcknowledgedSchema = z.object({
  questionCeiling: z.string().optional(),
  monthlyBudget: z.string().optional(),
});
export type Acknowledged = z.infer<typeof AcknowledgedSchema>;

/** What is sent, by use: a title ("The assistant (any game)") and its statements. */
export const WhatIsSentSchema = z.array(
  z.object({ title: z.string(), lines: z.array(z.string()) })
);
export type WhatIsSent = z.infer<typeof WhatIsSentSchema>;

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
  /** Exactly what is and is not sent: by use, one statement per line. */
  whatIsSent: WhatIsSentSchema,
  /** Dollars one question to the assistant may reach by RigReady's estimate before it stops and asks; 0 for no ceiling. */
  questionCeiling: z.number(),
  /** There are prices for the chosen model, so estimates can be shown and the limits can work. */
  priceKnown: z.boolean(),
  /** The prices estimates for the chosen model are worked out from; null when there are none. */
  prices: PriceBasisSchema.nullable(),
  /** RigReady's built-in prices for the chosen model; null for a model it has none for. */
  builtInPrices: PriceSchema.nullable(),
  /** When the built-in prices were recorded: "November 2026". */
  pricesRecorded: z.string(),
  /** This month's estimate against the monthly budget. */
  month: MonthBudgetSchema,
  /** Which limits the user acknowledged as counted from estimates, and when. */
  acknowledged: AcknowledgedSchema,
});
export type AiStatus = z.infer<typeof AiStatusSchema>;

export const UsageSchema = z.object({
  model: z.string(),
  input: z.number(),
  output: z.number(),
  cacheWrite: z.number(),
  cacheRead: z.number(),
  /** RigReady's estimate in US dollars, never a bill; null when there are no prices for the model. */
  cost: z.number().nullable(),
  /** Where the prices behind `cost` come from; null with no estimate. */
  prices: PriceSourceSchema.nullable().default(null),
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
  /** RigReady's estimate of what reading it costs; null when there are no prices for the model. */
  approxCost: z.number().nullable(),
  /** Where the prices behind `approxCost` come from; null with no estimate. */
  prices: PriceSourceSchema.nullable().default(null),
  /** The month against the monthly budget with this request counted in; null with no estimate. */
  month: MonthBudgetSchema.nullable().default(null),
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
