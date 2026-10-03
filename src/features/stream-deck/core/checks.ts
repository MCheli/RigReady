import { z } from 'zod';
import type {
  CaptureCandidate,
  CaptureDefinition,
  CheckDefinition,
  RemediationDefinition,
} from '../../../core/checks/registry';
import type { TrackedFileSuggestion } from '../../../core/games';
import type { Ports } from '../../../core/ports';
import { ok, type Result } from '../../../core/result';
import { closeApp, realSleep, startApp, type Sleep } from './app';
import { detectStreamDeck, streamDeckPaths, streamDecks } from './detect';

export const SD_RUNNING = 'stream-deck.running';
export const SD_CONNECTED = 'stream-deck.connected';
export const SD_START = 'stream-deck.start';

export const RunningParamsSchema = z.object({
  /** Quit the Stream Deck app when the user stands down. */
  closeOnStandDown: z.boolean().default(false),
});
export type RunningParams = z.infer<typeof RunningParamsSchema>;

export const runningCheck: CheckDefinition<RunningParams> = {
  type: SD_RUNNING,
  group: 'apps',
  label: 'Stream Deck app running',
  params: RunningParamsSchema,
  async run(_params, ctx) {
    const status = await detectStreamDeck(ctx.ports);
    if (!status.ok) return { pass: false, summary: status.error.message };
    if (status.value.running) return { pass: true, summary: 'Running' };
    return {
      pass: false,
      summary: status.value.installed ? 'Not running' : 'Not installed',
      ...(status.value.installed
        ? {}
        : { details: ['Install the Stream Deck app: Configure, Stream Deck.'] }),
    };
  },
  async standDown(params, ctx) {
    if (!params.closeOnStandDown) return ok(null);
    const closed = await closeApp(ctx.ports);
    if (!closed.ok) return closed;
    return ok(closed.value.closed ? 'Closed Stream Deck' : null);
  },
};

export const ConnectedParamsSchema = z.object({
  /** One particular Stream Deck, when the rig has several. */
  serial: z.string().optional(),
});
export type ConnectedParams = z.infer<typeof ConnectedParamsSchema>;

export const connectedCheck: CheckDefinition<ConnectedParams> = {
  type: SD_CONNECTED,
  group: 'devices',
  label: 'Stream Deck connected',
  params: ConnectedParamsSchema,
  async run(params, ctx) {
    const devices = await ctx.ports.devices.list();
    if (!devices.ok) return { pass: false, summary: devices.error.message };
    const found = streamDecks(devices.value).filter(
      (d) => params.serial === undefined || d.serial === params.serial
    );
    if (found.length === 0) return { pass: false, summary: 'Not connected' };
    return { pass: true, summary: `${found.map((d) => d.name).join(', ')} connected` };
  },
};

export const StartParamsSchema = z.object({});

export function createStartRemediation(sleep: Sleep = realSleep): RemediationDefinition<object> {
  return {
    type: SD_START,
    label: 'Start Stream Deck',
    order: 110,
    params: StartParamsSchema,
    describe: () => 'Start the Stream Deck app',
    run: (_params, ctx) => startApp(ctx.ports, sleep),
  };
}

export const streamDeckCapture: CaptureDefinition = {
  id: 'stream-deck',
  label: 'Stream Deck',
  async capture(ctx) {
    const status = await detectStreamDeck(ctx.ports);
    if (!status.ok) return status;
    const candidates: CaptureCandidate[] = [];
    if (status.value.installed && status.value.running) {
      candidates.push({
        key: 'stream-deck:running',
        group: 'apps',
        title: 'Stream Deck app',
        description: 'Finds the Stream Deck app wherever it is installed, and can start it.',
        // The generic "running apps" list offers StreamDeck.exe too; picking one is enough.
        selectedByDefault: false,
        check: {
          type: SD_RUNNING,
          title: 'Stream Deck app',
          required: false,
          params: { closeOnStandDown: false },
          remediation: { type: SD_START, params: {} },
        },
      });
    }
    const several = status.value.devices.length > 1;
    for (const device of status.value.devices) {
      candidates.push({
        key: `stream-deck:device:${device.serial ?? device.productId}`,
        group: 'devices',
        title:
          several && device.serial
            ? `Stream Deck hardware (${device.serial})`
            : 'Stream Deck hardware',
        description: several
          ? `${device.name}, serial ${device.serial ?? 'unknown'}`
          : `${device.name}, or any other Stream Deck`,
        selectedByDefault: false,
        check: {
          type: SD_CONNECTED,
          title: 'Stream Deck hardware',
          required: false,
          params: several && device.serial ? { serial: device.serial } : {},
        },
      });
    }
    return ok(candidates);
  },
};

/**
 * What a full backup should include for Stream Deck: the profiles folder (a folder path
 * means everything below it) and the plugin manifests. Plugins themselves are reinstalled.
 */
export async function streamDeckTrackedFiles(
  ports: Ports
): Promise<Result<TrackedFileSuggestion[]>> {
  const paths = await streamDeckPaths(ports);
  const out: TrackedFileSuggestion[] = [];
  if (await ports.files.exists(paths.profilesDir)) {
    out.push({ label: 'Stream Deck profiles', path: paths.profilesDir });
  }
  if (await ports.files.exists(paths.pluginsDir)) {
    out.push({ label: 'Stream Deck plugins and their settings', path: paths.pluginsDir });
  }
  return ok(out);
}
