import { z } from 'zod';
import { CheckGroupSchema, type CheckItem, type Profile } from '../profile/schema';
import type { CaptureCandidate, CheckContext, CheckRegistry } from './registry';

export const CheckStatusSchema = z.enum(['pass', 'fail', 'warn']);
export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const CheckResultSchema = z.object({
  itemId: z.string(),
  type: z.string(),
  group: CheckGroupSchema,
  title: z.string(),
  required: z.boolean(),
  /** pass, fail (a required check is not met) or warn (an optional check is not met). */
  status: CheckStatusSchema,
  summary: z.string(),
  details: z.array(z.string()),
  /** What Make ready would do for this item. Absent when there is no fix. */
  fix: z.string().optional(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const ChecklistReportSchema = z.object({
  profileId: z.string(),
  /** True when every required check passes. Optional checks never affect it. */
  ready: z.boolean(),
  failed: z.number().int(),
  warnings: z.number().int(),
  fixable: z.number().int(),
  results: z.array(CheckResultSchema),
});
export type ChecklistReport = z.infer<typeof ChecklistReportSchema>;

export const StepResultSchema = z.object({
  itemId: z.string(),
  title: z.string(),
  ok: z.boolean(),
  message: z.string(),
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const ActionReportSchema = z.object({
  steps: z.array(StepResultSchema),
  report: ChecklistReportSchema,
});
export type ActionReport = z.infer<typeof ActionReportSchema>;

const notMet = (item: CheckItem): CheckStatus => (item.required ? 'fail' : 'warn');

function describeFix(item: CheckItem, registry: CheckRegistry): string | undefined {
  if (!item.remediation) return undefined;
  const definition = registry.remediation(item.remediation.type);
  if (!definition) return undefined;
  const params = definition.params.safeParse(item.remediation.params);
  return params.success ? definition.describe(params.data) : undefined;
}

async function runOne(
  item: CheckItem,
  registry: CheckRegistry,
  ctx: CheckContext
): Promise<CheckResult> {
  const base = { itemId: item.id, type: item.type, title: item.title, required: item.required };
  const definition = registry.check(item.type);
  if (!definition) {
    return {
      ...base,
      group: 'other',
      status: notMet(item),
      summary: `This version of RigReady has no check of type "${item.type}".`,
      details: [],
    };
  }
  const params = definition.params.safeParse(item.params);
  if (!params.success) {
    return {
      ...base,
      group: definition.group,
      status: notMet(item),
      summary: 'This check is not set up correctly.',
      details: z.prettifyError(params.error).split('\n'),
    };
  }
  try {
    const outcome = await definition.run(params.data, ctx);
    const result: CheckResult = {
      ...base,
      group: definition.group,
      status: outcome.pass ? 'pass' : notMet(item),
      summary: outcome.summary,
      details: outcome.details ?? [],
    };
    if (!outcome.pass) {
      const fix = describeFix(item, registry);
      if (fix) result.fix = fix;
    }
    return result;
  } catch (e) {
    ctx.log.error(`check ${item.type} threw`, e);
    return {
      ...base,
      group: definition.group,
      status: notMet(item),
      summary: 'The check could not be completed.',
      details: [e instanceof Error ? e.message : String(e)],
    };
  }
}

export async function runChecks(
  profile: Profile,
  registry: CheckRegistry,
  ctx: CheckContext
): Promise<ChecklistReport> {
  const results = await Promise.all(profile.checks.map((item) => runOne(item, registry, ctx)));
  return {
    profileId: profile.id,
    ready: results.every((r) => r.status !== 'fail'),
    failed: results.filter((r) => r.status === 'fail').length,
    warnings: results.filter((r) => r.status === 'warn').length,
    fixable: results.filter((r) => r.fix !== undefined).length,
    results,
  };
}

/** Runs every available fix for checks that are not met, in remediation order, then re-checks. */
export async function makeReady(
  profile: Profile,
  registry: CheckRegistry,
  ctx: CheckContext
): Promise<ActionReport> {
  const before = await runChecks(profile, registry, ctx);
  const notPassing = new Set(
    before.results.filter((r) => r.status !== 'pass').map((r) => r.itemId)
  );

  const plan = profile.checks
    .filter((item) => notPassing.has(item.id) && item.remediation)
    .map((item) => ({ item, definition: registry.remediation(item.remediation!.type) }))
    .filter((entry) => entry.definition !== undefined)
    .sort((a, b) => a.definition!.order - b.definition!.order);

  const steps: StepResult[] = [];
  for (const { item, definition } of plan) {
    const params = definition!.params.safeParse(item.remediation!.params);
    if (!params.success) {
      steps.push({
        itemId: item.id,
        title: item.title,
        ok: false,
        message: 'The fix is not set up correctly.',
      });
      continue;
    }
    try {
      const outcome = await definition!.run(params.data, ctx);
      steps.push({
        itemId: item.id,
        title: item.title,
        ok: outcome.ok,
        message: outcome.ok
          ? outcome.value
          : outcome.error.detail
            ? `${outcome.error.message} ${outcome.error.detail}`
            : outcome.error.message,
      });
    } catch (e) {
      ctx.log.error(`remediation ${definition!.type} threw`, e);
      steps.push({
        itemId: item.id,
        title: item.title,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { steps, report: await runChecks(profile, registry, ctx) };
}

/** Runs the stand-down action of every check type that has one, then the registered stand-down steps, then re-checks. */
export async function standDown(
  profile: Profile,
  registry: CheckRegistry,
  ctx: CheckContext
): Promise<ActionReport> {
  const steps: StepResult[] = [];
  for (const item of profile.checks) {
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
          message: outcome.error.message,
        });
      } else if (outcome.value !== null) {
        steps.push({ itemId: item.id, title: item.title, ok: true, message: outcome.value });
      }
    } catch (e) {
      ctx.log.error(`standDown ${item.type} threw`, e);
      steps.push({
        itemId: item.id,
        title: item.title,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
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
      steps.push({
        itemId: step.id,
        title: step.label,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { steps, report: await runChecks(profile, registry, ctx) };
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
});

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
      problems.push(`${capture.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { candidates, problems };
}
