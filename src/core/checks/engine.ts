import { z } from 'zod';
import { CheckGroupSchema, type CheckGroup, type CheckItem, type Profile } from '../profile/schema';
import { GameKindSchema } from '../../shared/models';
import type {
  CaptureCandidate,
  CheckContext,
  CheckRegistry,
  CommandPreview,
  RemediationDefinition,
} from './registry';
import { withProfile } from './registry';

/**
 * pass; fail (a required check is not met); warn (an optional check is not met); error
 * (the check could not be evaluated: it threw, timed out, has bad params or an unknown
 * type). A required item in error makes the setup Not ready just like a failure.
 */
export const CheckStatusSchema = z.enum(['pass', 'fail', 'warn', 'error']);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const CommandPreviewSchema = z.object({
  exe: z.string(),
  args: z.array(z.string()),
  cwd: z.string().optional(),
});

export const CheckResultSchema = z.object({
  itemId: z.string(),
  type: z.string(),
  group: CheckGroupSchema,
  title: z.string(),
  required: z.boolean(),
  status: CheckStatusSchema,
  summary: z.string(),
  details: z.array(z.string()),
  /** What the fix does ("Start TrackIR5.exe"). Absent when there is no usable fix. */
  fix: z.string().optional(),
  /**
   * "action": Make ready runs it. "instructions": it only says what to do. "navigate": it
   * opens the screen where the user makes the change.
   */
  fixKind: z.enum(['action', 'instructions', 'navigate']).optional(),
  /** For an instructions fix: the text to show (Markdown subset). */
  instructions: z.string().optional(),
  /** Set when the fix runs a program the user must confirm first. */
  confirm: CommandPreviewSchema.optional(),
  /** Label of the check's own acknowledge action ("Mark verified"), when it has one. */
  acknowledge: z.string().optional(),
  /** Captured program output, for an expandable panel. */
  output: z.string().optional(),
  /** When this result was produced (ISO). */
  checkedAt: z.string().optional(),
  /**
   * The item is switched off in the setup (CheckItem.disabled): it was not checked. Its
   * status is "pass" only so that it never counts against readiness; show it as "Off".
   */
  disabled: z.boolean().optional(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const ChecklistReportSchema = z.object({
  profileId: z.string(),
  /** True when every required check passes. Optional checks never affect it. */
  ready: z.boolean(),
  /** Required items that are not met (failed or in error). */
  failed: z.number().int(),
  /** Optional items that are not met (warning or in error). */
  warnings: z.number().int(),
  /** Items whose fix Make ready can run. */
  fixable: z.number().int(),
  /** Items in error, required or not. */
  errors: z.number().int().default(0),
  results: z.array(CheckResultSchema),
});
export type ChecklistReport = z.infer<typeof ChecklistReportSchema>;

export const StepResultSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  ok: z.boolean(),
  message: z.string(),
  /** The step was not run (the user declined, or it needs a confirmation the caller cannot ask for). */
  skipped: z.boolean().optional(),
  /** Captured program output, when there is some. */
  output: z.string().optional(),
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const NeedsYouSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  summary: z.string(),
  /** What to do, when the item has instructions. */
  instructions: z.string().optional(),
  /** The item's own button ("Open Bindings → Device IDs ..."), when its fix opens a screen. */
  open: z.string().optional(),
});
export type NeedsYou = z.infer<typeof NeedsYouSchema>;

export const ActionReportSchema = z.object({
  steps: z.array(StepResultSchema),
  report: ChecklistReportSchema,
  /** Items still not met that no fix can handle: the user has to act. */
  needsYou: z.array(NeedsYouSchema).default([]),
});
export type ActionReport = z.infer<typeof ActionReportSchema>;

const notMet = (item: CheckItem): CheckStatus => (item.required ? 'fail' : 'warn');
const isNotMet = (status: CheckStatus): boolean => status !== 'pass';

export interface RunOptions {
  /** A check still running after this long is reported as an error ("Timed out"). Default: no limit. */
  timeoutMs?: number;
  /** Called as each result arrives, before the whole run finishes. */
  onResult?(result: CheckResult): void;
}

const TIMED_OUT = Symbol('timed out');

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Adds what the item's fix would do, when the fix is registered, valid and available. */
async function attachFix(
  result: CheckResult,
  item: CheckItem,
  registry: CheckRegistry,
  ctx: CheckContext
): Promise<void> {
  if (!item.remediation) return;
  const definition = registry.remediation(item.remediation.type);
  if (!definition) return;
  const params = definition.params.safeParse(item.remediation.params);
  if (!params.success) return;
  let description: string | undefined;
  if (definition.available) {
    try {
      const available = await definition.available(params.data, ctx);
      if (!available.ok) {
        result.details = [...result.details, available.reason];
        return;
      }
      description = available.description;
    } catch (e) {
      ctx.log.error(`remediation ${definition.type} availability threw`, e);
      return;
    }
  }
  result.fix = description ?? definition.describe(params.data);
  result.fixKind = definition.kind ?? 'action';
  if (definition.kind === 'instructions' && definition.instructions) {
    result.instructions = definition.instructions(params.data);
  }
  const confirm = definition.confirm?.(params.data);
  if (confirm) result.confirm = confirm;
}

/** Runs one checklist item. Never throws: every failure becomes a result. */
export async function runCheckItem(
  item: CheckItem,
  registry: CheckRegistry,
  ctx: CheckContext,
  options: RunOptions = {}
): Promise<CheckResult> {
  if (item.disabled) return disabledResult(item, registry, ctx);
  const result = await evaluate(item, registry, ctx, options);
  result.checkedAt = ctx.ports.clock.now().toISOString();
  if (registry.check(item.type)?.advisory) result.required = false;
  if (isNotMet(result.status)) {
    await attachFix(result, item, registry, ctx);
    const acknowledge = registry.check(item.type)?.acknowledge;
    if (acknowledge) result.acknowledge = acknowledge.label;
  }
  return result;
}

/** What a switched-off item reports: nothing ran, nothing to fix, never part of readiness. */
function disabledResult(item: CheckItem, registry: CheckRegistry, ctx: CheckContext): CheckResult {
  return {
    itemId: item.id,
    type: item.type,
    group: registry.check(item.type)?.group ?? 'other',
    title: item.title,
    required: false,
    status: 'pass',
    summary: 'Off: not checked',
    details: [],
    disabled: true,
    checkedAt: ctx.ports.clock.now().toISOString(),
  };
}

async function evaluate(
  item: CheckItem,
  registry: CheckRegistry,
  ctx: CheckContext,
  options: RunOptions
): Promise<CheckResult> {
  const base = { itemId: item.id, type: item.type, title: item.title, required: item.required };
  const definition = registry.check(item.type);
  if (!definition) {
    return {
      ...base,
      group: 'other',
      status: 'error',
      summary: `Check type "${item.type}" is not available in this version of RigReady.`,
      details: [],
    };
  }
  const params = definition.params.safeParse(item.params);
  if (!params.success) {
    return {
      ...base,
      group: definition.group,
      status: 'error',
      summary: 'This check is not set up correctly.',
      details: z.prettifyError(params.error).split('\n'),
    };
  }
  const ownSeconds = definition.timeoutSeconds?.(params.data);
  const timeoutMs =
    item.timeoutSeconds !== undefined
      ? item.timeoutSeconds * 1000
      : ownSeconds !== undefined
        ? ownSeconds * 1000
        : options.timeoutMs;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raced = await Promise.race([
      definition.run(params.data, ctx),
      ...(timeoutMs !== undefined
        ? [
            new Promise<typeof TIMED_OUT>((resolve) => {
              timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
            }),
          ]
        : []),
    ]).finally(() => clearTimeout(timer));
    if (raced === TIMED_OUT) {
      const seconds = Math.round((timeoutMs ?? 0) / 100) / 10;
      return {
        ...base,
        group: definition.group,
        status: 'error',
        summary: `Timed out after ${seconds} s`,
        details: [],
      };
    }
    const outcome = raced;
    const result: CheckResult = {
      ...base,
      // An advisory check never counts against readiness.
      ...(definition.advisory ? { required: false } : {}),
      group: definition.group,
      status: outcome.pass
        ? 'pass'
        : outcome.error
          ? 'error'
          : definition.advisory
            ? 'warn'
            : notMet(item),
      summary: outcome.summary,
      details: outcome.details ?? [],
    };
    if (outcome.output) result.output = outcome.output;
    return result;
  } catch (e) {
    ctx.log.error(`check ${item.type} threw`, e);
    return {
      ...base,
      group: definition.group,
      status: 'error',
      summary: 'The check could not be completed.',
      details: [errorText(e)],
    };
  }
}

/** Builds the report for a set of results. */
export function summarize(profileId: string, results: CheckResult[]): ChecklistReport {
  const missed = (r: CheckResult): boolean => r.status === 'fail' || r.status === 'error';
  return {
    profileId,
    ready: results.every((r) => !(r.required && missed(r))),
    failed: results.filter((r) => r.required && missed(r)).length,
    warnings: results.filter((r) => !r.required && isNotMet(r.status)).length,
    fixable: results.filter((r) => r.fix !== undefined && r.fixKind === 'action').length,
    errors: results.filter((r) => r.status === 'error').length,
    results,
  };
}

/** Runs every check of a profile at the same time. One slow or hung check delays no other. */
export async function runChecks(
  profile: Profile,
  registry: CheckRegistry,
  baseCtx: CheckContext,
  options: RunOptions = {}
): Promise<ChecklistReport> {
  const ctx = withProfile(baseCtx, profile);
  const results = await Promise.all(
    profile.checks.map(async (item) => {
      const result = await runCheckItem(item, registry, ctx, options);
      options.onResult?.(result);
      return result;
    })
  );
  return summarize(profile.id, results);
}

/**
 * The order Make ready works in: monitors first (so helper apps open on the right
 * screens), then audio, config files, devices, then services and apps, then the rest
 * (scripts). Within a phase, the remediation's own order, then the profile's order.
 */
const PHASES: Record<CheckGroup, number> = {
  displays: 0,
  audio: 1,
  files: 2,
  devices: 3,
  apps: 4,
  other: 5,
};

export interface FixPlanEntry {
  item: CheckItem;
  definition: RemediationDefinition;
}

/** The fixes Make ready would run for a report, in order. Instruction-only fixes are not part of it. */
export function planFixes(
  profile: Profile,
  report: ChecklistReport,
  registry: CheckRegistry
): FixPlanEntry[] {
  const byId = new Map(report.results.map((r) => [r.itemId, r]));
  return profile.checks
    .map((item, index) => ({ item, index, result: byId.get(item.id) }))
    .filter((entry) => entry.result && isNotMet(entry.result.status) && entry.item.remediation)
    .map((entry) => ({
      ...entry,
      definition: registry.remediation(entry.item.remediation!.type),
    }))
    .filter(
      (entry): entry is typeof entry & { definition: RemediationDefinition } =>
        entry.definition !== undefined &&
        (entry.definition.kind ?? 'action') === 'action' &&
        // A fix that said it cannot run now (no backup yet) is left to "Needs you".
        (entry.result!.fix !== undefined || entry.definition.available === undefined)
    )
    .sort(
      (a, b) =>
        PHASES[a.result!.group] - PHASES[b.result!.group] ||
        a.definition.order - b.definition.order ||
        a.index - b.index
    )
    .map(({ item, definition }) => ({ item, definition }));
}

export interface FixOptions {
  /**
   * Asked before a fix that runs a program the user must confirm. Without it such fixes
   * are skipped (the tray cannot ask).
   */
  confirm?(item: CheckItem, command: CommandPreview): Promise<boolean>;
}

/** Runs one item's fix. Does not re-check; see fixItem for the verified version. */
async function runRemediation(
  item: CheckItem,
  definition: RemediationDefinition,
  ctx: CheckContext,
  options: FixOptions
): Promise<StepResult> {
  const base = { itemId: item.id, title: item.title };
  const params = definition.params.safeParse(item.remediation!.params);
  if (!params.success) return { ...base, ok: false, message: 'The fix is not set up correctly.' };
  if (definition.available) {
    const available = await definition.available(params.data, ctx).catch((e: unknown) => ({
      ok: false as const,
      reason: errorText(e),
    }));
    if (!available.ok) return { ...base, ok: false, skipped: true, message: available.reason };
  }
  const command = definition.confirm?.(params.data);
  if (command) {
    if (!options.confirm) {
      return {
        ...base,
        ok: false,
        skipped: true,
        message: 'Not run: this fix runs a program, so it needs your OK in the RigReady window.',
      };
    }
    if (!(await options.confirm(item, command))) {
      return { ...base, ok: false, skipped: true, message: 'Skipped by you' };
    }
  }
  try {
    let output: string | undefined;
    const outcome = await definition.run(params.data, {
      ...ctx,
      output: (text) => (output = text),
    });
    const printed = output ? { output } : {};
    if (outcome.ok) return { ...base, ok: true, message: outcome.value, ...printed };
    const step: StepResult = {
      ...base,
      ok: false,
      message: outcome.error.detail
        ? `${outcome.error.message} ${outcome.error.detail}`
        : outcome.error.message,
      ...printed,
    };
    return step;
  } catch (e) {
    ctx.log.error(`remediation ${definition.type} threw`, e);
    return { ...base, ok: false, message: errorText(e) };
  }
}

/** A fix counts as done only when the check passes afterwards. */
function verify(step: StepResult, result: CheckResult | undefined): StepResult {
  if (!step.ok || !result || result.status === 'pass') return step;
  return {
    ...step,
    ok: false,
    message: `${step.message}, but the check still fails: ${result.summary}`,
  };
}

/**
 * Runs one item's fix, then that item's check again. The step is ok only when the check
 * now passes.
 */
export async function fixItem(
  profile: Profile,
  itemId: string,
  registry: CheckRegistry,
  baseCtx: CheckContext,
  options: FixOptions & RunOptions = {}
): Promise<{ step: StepResult; result: CheckResult } | undefined> {
  const ctx = withProfile(baseCtx, profile);
  const item = profile.checks.find((c) => c.id === itemId);
  if (!item) return undefined;
  const definition = item.remediation ? registry.remediation(item.remediation.type) : undefined;
  let step: StepResult;
  if (item.disabled) {
    step = {
      itemId,
      title: item.title,
      ok: false,
      skipped: true,
      message: 'This item is switched off in the setup.',
    };
  } else if (!definition) {
    step = { itemId, title: item.title, ok: false, message: 'This item has no fix.' };
  } else if ((definition.kind ?? 'action') === 'instructions') {
    step = {
      itemId,
      title: item.title,
      ok: false,
      skipped: true,
      message: 'This item needs you: follow its instructions.',
    };
  } else {
    step = await runRemediation(item, definition, ctx, options);
  }
  const result = await runCheckItem(item, registry, ctx, options);
  // A fix that opens a screen has done its part when the screen is open: the check
  // changes only once the user has finished there.
  if (definition?.kind === 'navigate') return { step, result };
  return { step: verify(step, result), result };
}

export interface MakeReadyOptions extends FixOptions, RunOptions {
  /** Called as each fix starts and ends. */
  onProgress?(progress: {
    itemId: string;
    title: string;
    state: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
    message?: string;
  }): void;
  /** A report from just before, to save checking twice. */
  before?: ChecklistReport;
}

function needsYouOf(profile: Profile, report: ChecklistReport, steps: StepResult[]): NeedsYou[] {
  const fixed = new Set(steps.filter((s) => s.ok).map((s) => s.itemId));
  const byId = new Map(report.results.map((r) => [r.itemId, r]));
  return profile.checks
    .map((item) => byId.get(item.id))
    .filter(
      (r): r is CheckResult =>
        r !== undefined &&
        isNotMet(r.status) &&
        !fixed.has(r.itemId) &&
        (r.fixKind !== 'action' || steps.some((s) => s.itemId === r.itemId && s.skipped))
    )
    .map((r) => ({
      itemId: r.itemId,
      title: r.title,
      summary: r.summary,
      ...(r.instructions ? { instructions: r.instructions } : {}),
      ...(r.fixKind === 'navigate' && r.fix ? { open: r.fix } : {}),
    }));
}

/**
 * Runs every available fix for checks that are not met, in Make ready order, then
 * re-checks everything. A fix is reported done only when its check passes afterwards.
 */
export async function makeReady(
  profile: Profile,
  registry: CheckRegistry,
  baseCtx: CheckContext,
  options: MakeReadyOptions = {}
): Promise<ActionReport> {
  const ctx = withProfile(baseCtx, profile);
  const before = options.before ?? (await runChecks(profile, registry, ctx, options));
  const plan = planFixes(profile, before, registry);
  for (const { item } of plan) {
    options.onProgress?.({ itemId: item.id, title: item.title, state: 'pending' });
  }
  const steps: StepResult[] = [];
  for (const { item, definition } of plan) {
    options.onProgress?.({ itemId: item.id, title: item.title, state: 'running' });
    const step = await runRemediation(item, definition, ctx, options);
    steps.push(step);
    options.onProgress?.({
      itemId: item.id,
      title: item.title,
      state: step.skipped ? 'skipped' : step.ok ? 'done' : 'failed',
      message: step.message,
    });
  }
  const report = await runChecks(profile, registry, ctx, { timeoutMs: options.timeoutMs });
  const byId = new Map(report.results.map((r) => [r.itemId, r]));
  const verified = steps.map((s) => verify(s, byId.get(s.itemId)));
  return { steps: verified, report, needsYou: needsYouOf(profile, report, verified) };
}

export interface StandDownOptions extends RunOptions {
  /** Items whose stand-down action is skipped (e.g. the game itself, unless the user agreed). */
  skipItems?: Set<string>;
  /** Runs after the per-item stand-down actions and before the registered steps. */
  between?(): Promise<StepResult[]>;
}

/** Runs the stand-down action of every check type that has one, then the registered stand-down steps, then re-checks. */
export async function standDown(
  profile: Profile,
  registry: CheckRegistry,
  baseCtx: CheckContext,
  options: StandDownOptions = {}
): Promise<ActionReport> {
  const ctx = withProfile(baseCtx, profile);
  const steps: StepResult[] = [];
  for (const item of profile.checks) {
    if (options.skipItems?.has(item.id) || item.disabled) continue;
    const definition = registry.check(item.type);
    if (!definition?.standDown) continue;
    const params = definition.params.safeParse(item.params);
    if (!params.success) continue;
    try {
      const outcome = await definition.standDown(params.data, ctx);
      if (!outcome.ok) {
        steps.push({
          itemId: item.id,
          title: item.title,
          ok: false,
          message: outcome.error.detail
            ? `${outcome.error.message} ${outcome.error.detail}`
            : outcome.error.message,
        });
      } else if (outcome.value !== null) {
        steps.push({ itemId: item.id, title: item.title, ok: true, message: outcome.value });
      }
    } catch (e) {
      ctx.log.error(`standDown ${item.type} threw`, e);
      steps.push({ itemId: item.id, title: item.title, ok: false, message: errorText(e) });
    }
  }
  if (options.between) steps.push(...(await options.between()));
  for (const step of registry.standDownSteps()) {
    try {
      const outcome = await step.run(ctx);
      if (!outcome.ok) {
        steps.push({
          itemId: step.id,
          title: step.label,
          ok: false,
          message: outcome.error.detail
            ? `${outcome.error.message} ${outcome.error.detail}`
            : outcome.error.message,
        });
      } else if (outcome.value !== null) {
        steps.push({ itemId: step.id, title: step.label, ok: true, message: outcome.value });
      }
    } catch (e) {
      ctx.log.error(`standDown step ${step.id} threw`, e);
      steps.push({ itemId: step.id, title: step.label, ok: false, message: errorText(e) });
    }
  }
  const report = await runChecks(profile, registry, ctx, { timeoutMs: options.timeoutMs });
  return { steps, report, needsYou: [] };
}

export const CaptureCandidateSchema = z.object({
  key: z.string(),
  group: CheckGroupSchema,
  title: z.string(),
  description: z.string().optional(),
  selectedByDefault: z.boolean(),
  check: z.object({
    type: z.string(),
    title: z.string(),
    required: z.boolean(),
    params: z.record(z.string(), z.unknown()),
    remediation: z
      .object({ type: z.string(), params: z.record(z.string(), z.unknown()) })
      .optional(),
  }),
  game: z.string().optional(),
  ask: z
    .object({
      param: z.string(),
      label: z.string(),
      placeholder: z.string().optional(),
      hint: z.string().optional(),
    })
    .optional(),
  program: z.string().optional(),
  generic: z.boolean().optional(),
  covers: z.array(z.string()).optional(),
  kind: GameKindSchema.optional(),
  variant: z
    .object({ id: z.string(), name: z.string(), setupName: z.string().optional() })
    .optional(),
  tier: z.enum(['main', 'more']).optional(),
  icon: z.string().optional(),
  device: z
    .object({
      vendorId: z.string(),
      productId: z.string(),
      serial: z.string().optional(),
      gameController: z.boolean(),
      identifiedBy: z.enum(['ids', 'serial', 'port']),
      twin: z.object({ index: z.number().int(), of: z.number().int() }).optional(),
      model: z.string().optional(),
    })
    .optional(),
  monitors: z
    .array(
      z.object({
        label: z.string(),
        enabled: z.boolean(),
        primary: z.boolean(),
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
        rotation: z.number(),
      })
    )
    .optional(),
  standDownNote: z.string().optional(),
});

const processName = (candidate: CaptureCandidate): string | undefined =>
  candidate.program?.toLowerCase();
/** The list of running apps; every other capture knows more about its program. */
const isGeneric = (candidate: CaptureCandidate): boolean => candidate.generic === true;

/**
 * Several captures can propose the same program: the generic list of running apps, a
 * feature that knows the program by name ("Fanatec Service" for FanatecService.exe), and
 * a feature with a check of its own for it (Stream Deck, TrackIR). One is enough: the
 * most specific stays, and it is kept by default when any of them was.
 */
export function dedupeCandidates(candidates: CaptureCandidate[]): CaptureCandidate[] {
  const dropped = new Set<CaptureCandidate>();
  const keepSelected = (kept: CaptureCandidate, gone: CaptureCandidate): void => {
    dropped.add(gone);
    if (gone.selectedByDefault) kept.selectedByDefault = true;
    // How the program is shown (icon, family) is known to whoever knows the program.
    if (kept.icon === undefined && gone.icon !== undefined) kept.icon = gone.icon;
    if (kept.kind === undefined && gone.kind !== undefined) kept.kind = gone.kind;
  };
  for (const candidate of candidates) {
    for (const covered of candidate.covers ?? []) {
      for (const other of candidates) {
        if (other === candidate || dropped.has(other) || !isGeneric(other)) continue;
        if (processName(other) === covered.toLowerCase()) keepSelected(candidate, other);
      }
    }
  }
  const byProgram = new Map<string, CaptureCandidate>();
  for (const candidate of candidates) {
    if (dropped.has(candidate)) continue;
    const name = processName(candidate);
    if (!name) continue;
    const first = byProgram.get(name);
    if (!first) {
      byProgram.set(name, candidate);
    } else if (isGeneric(first) && !isGeneric(candidate)) {
      keepSelected(candidate, first);
      byProgram.set(name, candidate);
    } else {
      keepSelected(first, candidate);
    }
  }
  return candidates.filter((c) => !dropped.has(c));
}

/** Asks every registered capture what it would check, given the machine as it is now. */
export async function captureCandidates(
  registry: CheckRegistry,
  ctx: CheckContext
): Promise<{ candidates: CaptureCandidate[]; problems: string[] }> {
  const candidates: CaptureCandidate[] = [];
  const problems: string[] = [];
  for (const capture of registry.allCaptures()) {
    try {
      const found = await capture.capture(ctx);
      if (found.ok) candidates.push(...found.value);
      else problems.push(`${capture.label}: ${found.error.message}`);
    } catch (e) {
      ctx.log.error(`capture ${capture.id} threw`, e);
      problems.push(`${capture.label}: ${errorText(e)}`);
    }
  }
  return { candidates: dedupeCandidates(candidates), problems };
}
