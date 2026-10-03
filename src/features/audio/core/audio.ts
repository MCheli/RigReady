import { z } from 'zod';
import type {
  CaptureCandidate,
  CaptureDefinition,
  CheckDefinition,
  CheckOutcome,
  RemediationDefinition,
} from '../../../core/checks/registry';
import type { AudioProvider } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import type { AudioDevice, AudioRole, AudioState } from '../../../shared/models';

export const AUDIO_DEFAULT = 'audio.defaultDevice';
export const AUDIO_SET_DEFAULT = 'audio.setDefault';

export const FlowSchema = z.enum(['playback', 'recording']);
export type Flow = z.infer<typeof FlowSchema>;

/**
 * Which of Windows' defaults a check is about. "default" is the device Windows uses for
 * everything ("Set as Default Device"); "communications" is the one voice chat apps use
 * ("Set as Default Communication Device"); "both" means the same device is both.
 */
export const DefaultRoleSchema = z.enum(['default', 'communications', 'both']);
export type DefaultRole = z.infer<typeof DefaultRoleSchema>;

/** A setup's audio check: this device must be Windows' default. */
export const AudioParamsSchema = z.object({
  flow: FlowSchema,
  /** Windows endpoint id. */
  id: z.string().min(1),
  /** The device's name when the setup was made; used when the id is no longer found. */
  name: z.string().min(1),
  role: DefaultRoleSchema.default('default'),
});
export type AudioParams = z.infer<typeof AudioParamsSchema>;

const covers = (role: DefaultRole) => ({
  main: role === 'default' || role === 'both',
  comms: role === 'communications' || role === 'both',
});

export const rolesFor = (role: DefaultRole): AudioRole[] => {
  const { main, comms } = covers(role);
  return [
    ...(main ? (['console', 'multimedia'] as AudioRole[]) : []),
    ...(comms ? (['communications'] as AudioRole[]) : []),
  ];
};

export function defaultOf(state: AudioState, flow: Flow, comms = false): AudioDevice | undefined {
  if (flow === 'playback') return comms ? state.defaultCommsPlayback : state.defaultPlayback;
  return comms ? state.defaultCommsRecording : state.defaultRecording;
}

/**
 * The device a check means, among those connected now: by endpoint id, or, when Windows
 * gave it a new id (driver reinstall, other USB port), by its exact name if only one
 * device of that flow has it.
 */
export function findDevice(
  state: AudioState,
  params: Pick<AudioParams, 'flow' | 'id' | 'name'>
): { device: AudioDevice; byName: boolean } | undefined {
  const byId = state.devices.find((d) => d.id === params.id);
  if (byId) return { device: byId, byName: false };
  const named = state.devices.filter(
    (d) => d.flow === params.flow && d.name.toLowerCase() === params.name.toLowerCase()
  );
  return named.length === 1 ? { device: named[0]!, byName: true } : undefined;
}

const flowWord = (flow: Flow): string => (flow === 'playback' ? 'output' : 'input');

export const audioDefaultCheck: CheckDefinition<AudioParams> = {
  type: AUDIO_DEFAULT,
  group: 'audio',
  label: 'Default audio device',
  params: AudioParamsSchema,
  async run(params, ctx): Promise<CheckOutcome> {
    const state = await ctx.ports.audio.read();
    if (!state.ok) return { pass: false, summary: state.error.message };
    const found = findDevice(state.value, params);
    const { main, comms } = covers(params.role);
    if (!found) {
      const now = defaultOf(state.value, params.flow, !main);
      return {
        pass: false,
        summary: `${params.name} is not connected`,
        details: [
          now
            ? `Windows is using ${now.name} instead.`
            : `Windows has no default ${flowWord(params.flow)} device.`,
        ],
      };
    }
    const wanted = found.device;
    const problems: string[] = [];
    if (main) {
      const now = defaultOf(state.value, params.flow);
      if (now?.id !== wanted.id) problems.push(`Default is ${now?.name ?? 'nothing'}`);
    }
    if (comms) {
      const now = defaultOf(state.value, params.flow, true);
      if (now?.id !== wanted.id) problems.push(`Default for calls is ${now?.name ?? 'nothing'}`);
    }
    const notes = found.byName
      ? [`Found by name: Windows now lists ${wanted.name} under a different id.`]
      : [];
    if (problems.length === 0) {
      const summary =
        params.role === 'both'
          ? `Default ${flowWord(params.flow)}, also for calls`
          : params.role === 'communications'
            ? `Default ${flowWord(params.flow)} for calls`
            : `Default ${flowWord(params.flow)}`;
      return notes.length ? { pass: true, summary, details: notes } : { pass: true, summary };
    }
    return {
      pass: false,
      summary: problems.join('; '),
      ...(notes.length ? { details: notes } : {}),
    };
  },
};

/**
 * Remembers what was the default before a fix changed it, per flow and role, so Stand
 * down can switch back. In memory only: after a restart there is nothing to undo.
 */
export class PreviousDefaults {
  private readonly saved = new Map<string, { setId: string; previous: AudioDevice }>();

  private key(flow: Flow, comms: boolean): string {
    return `${flow}/${comms ? 'comms' : 'main'}`;
  }

  remember(flow: Flow, comms: boolean, setId: string, previous: AudioDevice | undefined): void {
    if (!previous || previous.id === setId) return;
    // The first fix of a session wins: that is the device the user had before.
    if (!this.saved.has(this.key(flow, comms))) {
      this.saved.set(this.key(flow, comms), { setId, previous });
    }
  }

  take(flow: Flow, comms: boolean): { setId: string; previous: AudioDevice } | undefined {
    const key = this.key(flow, comms);
    const entry = this.saved.get(key);
    this.saved.delete(key);
    return entry;
  }
}

/** Makes a device the default and reads it back; fails when Windows did not do it. */
export async function makeDefault(
  audio: AudioProvider,
  device: AudioDevice,
  role: DefaultRole
): Promise<Result<AudioState>> {
  const after = await audio.setDefault(device.id, { roles: rolesFor(role) });
  if (!after.ok) return after;
  const { main, comms } = covers(role);
  const mainOk = !main || defaultOf(after.value, device.flow)?.id === device.id;
  const commsOk = !comms || defaultOf(after.value, device.flow, true)?.id === device.id;
  if (!mainOk || !commsOk) {
    return err('audio.setDefault', `Windows did not make ${device.name} the default.`);
  }
  return after;
}

export function createSetDefaultRemediation(
  previous: PreviousDefaults
): RemediationDefinition<AudioParams> {
  return {
    type: AUDIO_SET_DEFAULT,
    label: 'Set the default audio device',
    order: 250,
    params: AudioParamsSchema,
    describe: (p) =>
      p.role === 'communications'
        ? `Make ${p.name} the default for calls`
        : `Make ${p.name} the default ${flowWord(p.flow)}`,
    async run(params, ctx) {
      const state = await ctx.ports.audio.read();
      if (!state.ok) return state;
      const found = findDevice(state.value, params);
      if (!found) {
        return err(
          'audio.missing',
          `${params.name} is not connected, so it cannot be made the default.`,
          'Plug it in or switch it on, then check again.'
        );
      }
      const device = found.device;
      const { main, comms } = covers(params.role);
      const before = {
        main: defaultOf(state.value, params.flow),
        comms: defaultOf(state.value, params.flow, true),
      };
      const done = await makeDefault(ctx.ports.audio, device, params.role);
      if (!done.ok) return done;
      if (main) previous.remember(params.flow, false, device.id, before.main);
      if (comms) previous.remember(params.flow, true, device.id, before.comms);
      return ok(
        params.role === 'communications'
          ? `Made ${device.name} the default for calls`
          : `Made ${device.name} the default ${flowWord(params.flow)}`
      );
    },
  };
}

/**
 * Stand down for an audio check: if a fix changed the default during this session and it
 * is still what the fix set, put back the device that was the default before.
 */
export function createAudioStandDown(previous: PreviousDefaults) {
  return async (
    params: AudioParams,
    ctx: { ports: { audio: AudioProvider } }
  ): Promise<Result<string | null>> => {
    const { main, comms } = covers(params.role);
    const lines: string[] = [];
    for (const which of [main ? false : null, comms ? true : null]) {
      if (which === null) continue;
      const entry = previous.take(params.flow, which);
      if (!entry) continue;
      const state = await ctx.ports.audio.read();
      if (!state.ok) return state;
      // The user changed it themselves since: leave it alone.
      if (defaultOf(state.value, params.flow, which)?.id !== entry.setId) continue;
      const back = state.value.devices.find((d) => d.id === entry.previous.id);
      if (!back) continue;
      const done = await makeDefault(ctx.ports.audio, back, which ? 'communications' : 'default');
      if (!done.ok) return done;
      lines.push(
        which ? `${back.name} is the default for calls again` : `${back.name} is the default again`
      );
    }
    return ok(lines.length ? lines.join('; ') : null);
  };
}

/** "Capture current state": the default devices as they are now. */
export const audioCapture: CaptureDefinition = {
  id: 'audio',
  label: 'Audio',
  async capture(ctx) {
    const state = await ctx.ports.audio.read();
    if (!state.ok) return state;
    const candidates: CaptureCandidate[] = [];
    for (const flow of ['playback', 'recording'] as const) {
      const main = defaultOf(state.value, flow);
      const comms = defaultOf(state.value, flow, true);
      const what = flow === 'playback' ? 'Sound output' : 'Microphone';
      if (main) {
        const role: DefaultRole = comms?.id === main.id ? 'both' : 'default';
        const params: AudioParams = { flow, id: main.id, name: main.name, role };
        const title = `${what}: ${main.name}`;
        candidates.push({
          key: `audio:${flow}`,
          group: 'audio',
          title,
          description:
            role === 'both'
              ? `The default ${flowWord(flow)} device, also for calls`
              : `The default ${flowWord(flow)} device`,
          selectedByDefault: true,
          check: {
            type: AUDIO_DEFAULT,
            title,
            required: true,
            params,
            remediation: { type: AUDIO_SET_DEFAULT, params },
          },
        });
      }
      if (comms && comms.id !== main?.id) {
        const params: AudioParams = {
          flow,
          id: comms.id,
          name: comms.name,
          role: 'communications',
        };
        const title = `${what} for calls: ${comms.name}`;
        candidates.push({
          key: `audio:${flow}:comms`,
          group: 'audio',
          title,
          description: `The ${flowWord(flow)} device Windows gives voice chat apps`,
          selectedByDefault: false,
          check: {
            type: AUDIO_DEFAULT,
            title,
            required: false,
            params,
            remediation: { type: AUDIO_SET_DEFAULT, params },
          },
        });
      }
    }
    return ok(candidates);
  },
};
