import path from 'node:path';
import type { StepResult } from '../../../core/checks/engine';
import type { CheckContext, CheckRegistry, CommandPreview } from '../../../core/checks/registry';
import type { LaunchAction } from '../../../core/profile/schema';

/** Injected so tests do not wait in real time. */
export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const DEFAULT_ACTION_TIMEOUT_SECONDS = 30;

/** The remediation params an action runs with: its own params plus its options. */
export function actionParams(action: LaunchAction): Record<string, unknown> {
  return {
    ...action.params,
    ...(action.waitForCompletion !== undefined
      ? { waitForCompletion: action.waitForCompletion }
      : {}),
    ...(action.hidden !== undefined ? { hidden: action.hidden } : {}),
    ...(action.timeoutSeconds !== undefined ? { timeoutSeconds: action.timeoutSeconds } : {}),
  };
}

/** The program an action would run, when it must be confirmed by the user first. */
export function actionConfirmation(
  action: LaunchAction,
  registry: CheckRegistry
): CommandPreview | undefined {
  const definition = registry.remediation(action.type);
  if (!definition?.confirm) return undefined;
  const params = definition.params.safeParse(actionParams(action));
  return params.success ? definition.confirm(params.data) : undefined;
}

/**
 * What a step was set to, by name, when that was chosen from a list: which virtual
 * controller "Start a virtual controller" starts. The name the setup stored with the
 * choice comes first (the first param the list fills in). A setup written without one, by
 * hand or before the lists were there, is looked up in the list as it is now.
 */
export async function chosenName(
  action: LaunchAction,
  registry: CheckRegistry,
  ctx: CheckContext
): Promise<string | undefined> {
  const picker = registry.remediation(action.type)?.picker;
  if (!picker) return undefined;
  const nameParam = picker.fills?.[0];
  const stored = nameParam ? action.params[nameParam] : undefined;
  if (typeof stored === 'string' && stored.trim() !== '') return stored.trim();
  const value = action.params[picker.param];
  if (typeof value !== 'string' || value === '') return undefined;
  try {
    const listed = await picker.choices(ctx);
    return listed.ok ? listed.value.find((choice) => choice.value === value)?.label : undefined;
  } catch (e) {
    // A list that cannot be read is no reason to fail the Play page: the title stands alone.
    ctx.log.error(`picker ${picker.list} threw`, e);
    return undefined;
  }
}

/** The image name a start-program action leaves running, for closing it at Stand down. */
export function startedProgram(action: LaunchAction): string | undefined {
  if (action.type !== 'process.launch') return undefined;
  const waitFor = action.params['waitFor'];
  if (typeof waitFor === 'string' && waitFor) return waitFor;
  const exe = action.params['exe'];
  return typeof exe === 'string' ? path.win32.basename(exe.replace(/\//g, '\\')) : undefined;
}

export interface ActionOptions {
  /** Waits for an action's timeout. */
  timer: Sleep;
  /** Action ids the user agreed to run, for actions that must be confirmed. */
  approved: Set<string>;
}

const TIMED_OUT = Symbol('timed out');

/** Runs one action through its remediation type, with its timeout. Never throws. */
export async function runAction(
  action: LaunchAction,
  registry: CheckRegistry,
  ctx: CheckContext,
  options: ActionOptions
): Promise<StepResult> {
  const base = { itemId: action.id, title: action.title };
  const definition = registry.remediation(action.type);
  if (!definition) {
    return {
      ...base,
      ok: false,
      message: `Action type "${action.type}" is not available in this version of RigReady.`,
    };
  }
  if ((definition.kind ?? 'action') === 'instructions') {
    return { ...base, ok: true, skipped: true, message: 'Instructions only; nothing to run.' };
  }
  const params = definition.params.safeParse(actionParams(action));
  if (!params.success)
    return { ...base, ok: false, message: 'This action is not set up correctly.' };
  if (definition.confirm?.(params.data) && !options.approved.has(action.id)) {
    return {
      ...base,
      ok: false,
      skipped: true,
      message: 'Not run: it needs your OK, and it was not given.',
    };
  }
  const seconds = action.timeoutSeconds ?? DEFAULT_ACTION_TIMEOUT_SECONDS;
  try {
    // What the program printed is kept with the step, whether it worked or not.
    let output: string | undefined;
    const raced = await Promise.race([
      definition.run(params.data, { ...ctx, output: (text) => (output = text) }),
      // A little longer than the action's own timeout, so its own message wins when it has one.
      options.timer(seconds * 1000 + 1000).then((): typeof TIMED_OUT => TIMED_OUT),
    ]);
    if (raced === TIMED_OUT) {
      return { ...base, ok: false, message: `Timed out after ${seconds} s` };
    }
    if (raced.ok) return { ...base, ok: true, message: raced.value, ...(output ? { output } : {}) };
    const printed = output ?? raced.error.detail;
    return {
      ...base,
      ok: false,
      message: raced.error.message,
      ...(printed ? { output: printed } : {}),
    };
  } catch (e) {
    ctx.log.error(`action ${action.type} threw`, e);
    return { ...base, ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
