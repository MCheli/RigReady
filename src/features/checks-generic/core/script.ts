import { z } from 'zod';
import type {
  CheckContext,
  CheckDefinition,
  RemediationDefinition,
} from '../../../core/checks/registry';
import type { GameRegistry } from '../../../core/games';
import type { ShellResult } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { scriptEnvironment } from '../../../core/scriptEnv';
import { fileName, lastLines, resolveStored } from './paths';

export const SCRIPT_CHECK = 'script.check';
export const SCRIPT_RUN = 'script.run';

/** Injected so tests do not wait in real time. */
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ScriptBase = {
  /** The program or script (.cmd, .bat, .ps1 through powershell.exe, .exe). Path variables allowed. */
  exe: z.string().min(1),
  /** Each argument is passed as it is: nothing is ever joined into a command line. */
  args: z.array(z.string()).default([]),
  cwd: z.string().min(1).optional(),
  /** Exit codes that count as success. */
  successExitCodes: z.array(z.number().int()).min(1).default([0]),
};

export const ScriptCheckParamsSchema = z.object({
  ...ScriptBase,
  timeoutSeconds: z.number().int().min(1).max(600).default(10),
});
export type ScriptCheckParams = z.infer<typeof ScriptCheckParamsSchema>;

export const ScriptRunParamsSchema = z.object({
  ...ScriptBase,
  timeoutSeconds: z.number().int().min(1).max(3600).default(30),
  /** Wait for it to finish (and judge its exit code). Off: start it and go on. */
  waitForCompletion: z.boolean().default(true),
  /** No console window. Programs started without waiting always get their own window. */
  hidden: z.boolean().default(true),
  /** Ask the user, showing the exact program and arguments, before every run. */
  requiresConfirmation: z.boolean().default(true),
});
export type ScriptRunParams = z.infer<typeof ScriptRunParamsSchema>;

const TIMED_OUT = Symbol('timed out');
/** How much of a program's output is kept for the user to read. */
const OUTPUT_LINES = 200;

type Run =
  | { kind: 'missing'; path: string }
  | { kind: 'failed'; message: string; detail?: string }
  | { kind: 'timeout'; exe: string; seconds: number }
  | { kind: 'done'; exe: string; code: number | null; output: string };

/** Runs a program to completion with a timeout. The real Shell also kills it at the timeout. */
async function runProgram(
  params: z.infer<z.ZodObject<typeof ScriptBase>> & { timeoutSeconds: number; hidden?: boolean },
  ctx: CheckContext,
  games: GameRegistry,
  sleep: Sleep
): Promise<Run> {
  const exe = await resolveStored(params.exe, ctx, games);
  if (!exe.ok)
    return {
      kind: 'failed',
      message: exe.error.message,
      ...(exe.error.detail ? { detail: exe.error.detail } : {}),
    };
  if (!(await ctx.ports.files.exists(exe.value))) return { kind: 'missing', path: exe.value };
  const cwd = params.cwd ? await resolveStored(params.cwd, ctx, games) : undefined;
  if (cwd && !cwd.ok) return { kind: 'failed', message: cwd.error.message };
  const timeoutMs = params.timeoutSeconds * 1000;
  const raced = await Promise.race([
    ctx.ports.shell.run(exe.value, params.args, {
      timeoutMs,
      // Values from the setup reach the script as environment variables, never as command text.
      env: await scriptEnvironment(ctx, games),
      hidden: params.hidden ?? true,
      ...(cwd ? { cwd: cwd.value } : {}),
    }),
    sleep(timeoutMs + 500).then((): typeof TIMED_OUT => TIMED_OUT),
  ]);
  if (raced === TIMED_OUT)
    return { kind: 'timeout', exe: exe.value, seconds: params.timeoutSeconds };
  const result: Result<ShellResult> = raced;
  if (!result.ok) {
    return {
      kind: 'failed',
      message: result.error.message,
      ...(result.error.detail ? { detail: result.error.detail } : {}),
    };
  }
  // The real Shell kills a program at its timeout; it then has no exit code.
  if (result.value.code === null)
    return { kind: 'timeout', exe: exe.value, seconds: params.timeoutSeconds };
  const output = [result.value.stdout, result.value.stderr]
    .filter((t) => t.trim() !== '')
    .join('\n');
  return { kind: 'done', exe: exe.value, code: result.value.code, output };
}

export function createScriptCheck(
  games: GameRegistry,
  sleep: Sleep = realSleep
): CheckDefinition<ScriptCheckParams> {
  return {
    type: SCRIPT_CHECK,
    group: 'other',
    label: 'Script succeeds',
    params: ScriptCheckParamsSchema,
    fixes: [SCRIPT_RUN, 'instructions.show'],
    // Its own timeout, plus a little: the script decides, not the settings' check timeout.
    timeoutSeconds: (params) => params.timeoutSeconds + 2,
    async run(params, ctx) {
      const run = await runProgram(params, ctx, games, sleep);
      switch (run.kind) {
        case 'missing':
          return { pass: false, error: true, summary: `Script not found: ${run.path}` };
        case 'failed':
          return {
            pass: false,
            error: true,
            summary: run.message,
            details: run.detail ? [run.detail] : [],
          };
        case 'timeout':
          return { pass: false, error: true, summary: `Timed out after ${run.seconds} s` };
        case 'done': {
          const passed = run.code !== null && params.successExitCodes.includes(run.code);
          return {
            pass: passed,
            summary: passed ? 'Succeeded' : `Exit code ${run.code}`,
            ...(!passed && run.output ? { output: lastLines(run.output, 50) } : {}),
          };
        }
      }
    },
  };
}

export function createScriptRemediation(
  games: GameRegistry,
  sleep: Sleep = realSleep
): RemediationDefinition<ScriptRunParams> {
  return {
    type: SCRIPT_RUN,
    label: 'Run a script',
    // After the apps: scripts usually expect them to be running.
    order: 500,
    params: ScriptRunParamsSchema,
    describe: (params) => `Run ${fileName(params.exe)}`,
    confirm: (params) =>
      params.requiresConfirmation
        ? { exe: params.exe, args: params.args, ...(params.cwd ? { cwd: params.cwd } : {}) }
        : undefined,
    async run(params, ctx) {
      const name = fileName(params.exe);
      if (!params.waitForCompletion) {
        const exe = await resolveStored(params.exe, ctx, games);
        if (!exe.ok) return exe;
        if (!(await ctx.ports.files.exists(exe.value))) {
          return err('script.missing', `Script not found: ${exe.value}`);
        }
        const cwd = params.cwd ? await resolveStored(params.cwd, ctx, games) : undefined;
        if (cwd && !cwd.ok) return cwd;
        const started = await ctx.ports.shell.launch(exe.value, params.args, {
          env: await scriptEnvironment(ctx, games),
          hidden: params.hidden,
          ...(cwd ? { cwd: cwd.value } : {}),
        });
        if (!started.ok) return started;
        // Not waited for, so the one thing that can be known: Windows gave it a process.
        if (started.value.pid === undefined) {
          return err('script.notStarted', `${name} was started but did not get a process.`);
        }
        return ok(`Started ${name}`);
      }
      const run = await runProgram(params, ctx, games, sleep);
      switch (run.kind) {
        case 'missing':
          return err('script.missing', `Script not found: ${run.path}`);
        case 'failed':
          return err('script.failed', run.message, run.detail);
        case 'timeout':
          return err('script.timeout', `${name} timed out after ${run.seconds} s`);
        case 'done':
          // The last 200 lines of what it printed go with the step, success or not.
          if (run.output) ctx.output?.(lastLines(run.output, OUTPUT_LINES));
          if (run.code !== null && params.successExitCodes.includes(run.code)) {
            return ok(`Ran ${name}`);
          }
          return err(
            'script.exit',
            `${name} exited with code ${run.code}`,
            run.output ? lastLines(run.output, 50) : undefined
          );
      }
    },
  };
}
