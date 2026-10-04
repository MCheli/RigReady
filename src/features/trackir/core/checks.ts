import { z } from 'zod';
import type {
  CaptureCandidate,
  CaptureDefinition,
  CheckDefinition,
  RemediationDefinition,
} from '../../../core/checks/registry';
import type { Ports } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { detectTrackIr, findExe, isTrackIr, isTrackIrProcess } from './trackir';

export const TIR_RUNNING = 'trackir.running';
export const TIR_CONNECTED = 'trackir.connected';
export const TIR_START = 'trackir.start';

/** Injected so tests do not wait in real time. */
export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const RunningParamsSchema = z.object({
  /** Quit TrackIR when the user stands down. */
  closeOnStandDown: z.boolean().default(false),
});
export type RunningParams = z.infer<typeof RunningParamsSchema>;

export const runningCheck: CheckDefinition<RunningParams> = {
  type: TIR_RUNNING,
  group: 'apps',
  label: 'TrackIR running',
  params: RunningParamsSchema,
  async run(_params, ctx) {
    const status = await detectTrackIr(ctx.ports);
    if (!status.ok) return { pass: false, summary: status.error.message };
    const s = status.value;
    if (!s.installed) return { pass: false, summary: 'Not installed' };
    if (!s.running) return { pass: false, summary: 'Not running' };
    if (!s.npClient.ok) {
      // Running but invisible to games is still a problem worth a line.
      return { pass: true, summary: 'Running', details: [s.npClient.problem ?? ''] };
    }
    return { pass: true, summary: 'Running' };
  },
  async standDown(params, ctx) {
    if (!params.closeOnStandDown) return ok(null);
    const processes = await ctx.ports.processes.list();
    if (!processes.ok) return processes;
    const targets = processes.value.filter(isTrackIrProcess);
    for (const target of targets) {
      const closed = await ctx.ports.processes.close(target.pid, { waitMs: 10_000, force: true });
      if (!closed.ok) return closed;
    }
    return ok(targets.length ? 'Closed TrackIR' : null);
  },
};

export const ConnectedParamsSchema = z.object({});

export const connectedCheck: CheckDefinition<object> = {
  type: TIR_CONNECTED,
  group: 'devices',
  label: 'TrackIR camera connected',
  params: ConnectedParamsSchema,
  async run(_params, ctx) {
    const devices = await ctx.ports.devices.list();
    if (!devices.ok) return { pass: false, summary: devices.error.message };
    const found = devices.value.filter(isTrackIr);
    if (found.length === 0) return { pass: false, summary: 'Not connected' };
    const hub = found[0]!.hubChain[0]?.name;
    return {
      pass: true,
      summary: hub ? `${found[0]!.name} connected · ${hub}` : `${found[0]!.name} connected`,
    };
  },
};

/** Starts TrackIR and waits until it is running. */
export async function startTrackIr(
  ports: Ports,
  sleep: Sleep = realSleep,
  timeoutMs = 15_000
): Promise<Result<string>> {
  const { exe } = await findExe(ports);
  if (!exe) return err('trackir.notInstalled', 'TrackIR is not installed on this PC.');
  const before = await ports.processes.list();
  if (before.ok && before.value.some(isTrackIrProcess)) return ok('TrackIR is already running');
  const started = await ports.processes.start({ exe, args: [] });
  if (!started.ok) return started;
  const deadline = ports.clock.now().getTime() + timeoutMs;
  for (;;) {
    const now = await ports.processes.list();
    if (now.ok && now.value.some(isTrackIrProcess)) return ok('Started TrackIR');
    if (ports.clock.now().getTime() >= deadline) break;
    await sleep(250);
  }
  return err('trackir.notStarted', 'TrackIR was started but is not running.');
}

export function createStartRemediation(sleep: Sleep = realSleep): RemediationDefinition<object> {
  return {
    type: TIR_START,
    label: 'Start TrackIR',
    order: 110,
    params: z.object({}),
    describe: () => 'Start TrackIR',
    run: (_params, ctx) => startTrackIr(ctx.ports, sleep),
  };
}

export const trackIrCapture: CaptureDefinition = {
  id: 'trackir',
  label: 'TrackIR',
  async capture(ctx) {
    const status = await detectTrackIr(ctx.ports);
    if (!status.ok) return status;
    const candidates: CaptureCandidate[] = [];
    if (status.value.installed && status.value.running) {
      candidates.push({
        key: 'trackir:running',
        group: 'apps',
        title: 'TrackIR software',
        description: 'Finds TrackIR wherever it is installed, and can start it.',
        // Replaces the generic "TrackIR5.exe is running" candidate, and is kept when that was.
        selectedByDefault: false,
        covers: ['TrackIR5.exe'],
        standDownNote: 'closed at Stand down',
        check: {
          type: TIR_RUNNING,
          title: 'TrackIR software',
          required: true,
          // Only useful in the sim: Stand down closes it again.
          params: { closeOnStandDown: true },
          remediation: { type: TIR_START, params: {} },
        },
      });
    }
    if (status.value.devices.length > 0) {
      candidates.push({
        key: 'trackir:camera',
        group: 'devices',
        title: 'TrackIR camera',
        description: `${status.value.devices[0]!.name}, on any USB port`,
        selectedByDefault: false,
        icon: 'mdi-head-sync-outline',
        check: { type: TIR_CONNECTED, title: 'TrackIR camera', required: true, params: {} },
      });
    }
    return ok(candidates);
  },
};
