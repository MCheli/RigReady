import path from 'node:path';
import { z } from 'zod';
import type {
  CaptureCandidate,
  CaptureDefinition,
  CheckDefinition,
  RemediationDefinition,
} from '../../../core/checks/registry';
import { err, ok } from '../../../core/result';
import { LaunchTargetSchema } from '../../../shared/models';

export const PROCESS_RUNNING = 'process.running';
export const PROCESS_LAUNCH = 'process.launch';

export const ProcessParamsSchema = z.object({
  /** Image name, e.g. "TrackIR5.exe". Compared case-insensitively. */
  name: z.string().min(1),
  /** Close this app when the user stands down. */
  stopOnStandDown: z.boolean().default(false),
});
export type ProcessParams = z.infer<typeof ProcessParamsSchema>;

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export const processRunningCheck: CheckDefinition<ProcessParams> = {
  type: PROCESS_RUNNING,
  group: 'apps',
  label: 'App running',
  params: ProcessParamsSchema,
  async run(params, ctx) {
    const processes = await ctx.ports.processes.list();
    if (!processes.ok) return { pass: false, summary: processes.error.message };
    const running = processes.value.some((p) => sameName(p.name, params.name));
    return { pass: running, summary: running ? 'Running' : 'Not running' };
  },
  async standDown(params, ctx) {
    if (!params.stopOnStandDown) return ok(null);
    const processes = await ctx.ports.processes.list();
    if (!processes.ok) return processes;
    const targets = processes.value.filter((p) => sameName(p.name, params.name));
    if (targets.length === 0) return ok(null);
    for (const target of targets) {
      const stopped = await ctx.ports.processes.stop(target.pid);
      if (!stopped.ok) return stopped;
    }
    return ok(`Closed ${params.name}`);
  },
};

export const LaunchParamsSchema = LaunchTargetSchema.extend({
  /** Image name to wait for, when the launcher starts a differently named process. */
  waitFor: z.string().optional(),
  /** How long to wait for the process to appear. */
  timeoutMs: z.number().int().min(0).max(120_000).default(10_000),
});
export type LaunchParams = z.infer<typeof LaunchParamsSchema>;

const baseName = (exe: string): string => path.win32.basename(exe);

/** Injected so tests do not wait in real time. */
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createLaunchRemediation(
  sleep: Sleep = realSleep
): RemediationDefinition<LaunchParams> {
  return {
    type: PROCESS_LAUNCH,
    label: 'Start the app',
    order: 100,
    params: LaunchParamsSchema,
    describe: (params) => `Start ${baseName(params.exe)}`,
    async run(params, ctx) {
      const started = await ctx.ports.processes.start({
        exe: params.exe,
        args: params.args,
        ...(params.cwd ? { cwd: params.cwd } : {}),
      });
      if (!started.ok) return started;
      const expected = params.waitFor ?? baseName(params.exe);
      const deadline = ctx.ports.clock.now().getTime() + params.timeoutMs;
      for (;;) {
        const processes = await ctx.ports.processes.list();
        if (processes.ok && processes.value.some((p) => sameName(p.name, expected))) {
          return ok(`Started ${expected}`);
        }
        if (ctx.ports.clock.now().getTime() >= deadline) break;
        await sleep(250);
      }
      return err('process.notStarted', `${expected} was started but is not running.`);
    },
  };
}

const WINDOWS_DIR = /^[a-z]:\\windows\\/i;

export const processCapture: CaptureDefinition = {
  id: 'processes',
  label: 'Apps',
  async capture(ctx) {
    const processes = await ctx.ports.processes.list();
    if (!processes.ok) return processes;
    const byName = new Map<string, CaptureCandidate>();
    for (const process of processes.value) {
      // Only programs we could start again: a known path, and not part of Windows.
      if (!process.path || WINDOWS_DIR.test(process.path)) continue;
      const key = process.name.toLowerCase();
      if (byName.has(key)) continue;
      const title = process.name.replace(/\.exe$/i, '');
      byName.set(key, {
        key: `process:${key}`,
        group: 'apps',
        title,
        description: process.path,
        selectedByDefault: false,
        check: {
          type: PROCESS_RUNNING,
          title,
          required: true,
          params: { name: process.name, stopOnStandDown: false },
          remediation: { type: PROCESS_LAUNCH, params: { exe: process.path, args: [] } },
        },
      });
    }
    return ok([...byName.values()].sort((a, b) => a.title.localeCompare(b.title)));
  },
};
