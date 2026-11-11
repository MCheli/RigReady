import { z } from 'zod';
import type {
  CheckDefinition,
  RemediationDefinition,
  StandDownStep,
} from '../../../core/checks/registry';
import { err, ok } from '../../../core/result';
import { DRIVER_DOWNLOAD } from '../links';
import type { Emulator } from './emulator';
import { PROFILE_ID } from './profile';
import type { ProfileStore } from './store';

/**
 * What a setup can do with a virtual controller: check that the driver is there, start one
 * as a step before launch, stop it as a step at Stand down; and Stand down stops one that
 * a setup started.
 */

export const DRIVER_SERVICE = 'ViGEmBus';

export const driverCheck: CheckDefinition<Record<string, never>> = {
  type: 'virtual-controller.driver',
  group: 'apps',
  label: 'Virtual controller driver installed',
  params: z.object({}).strict() as z.ZodType<Record<string, never>>,
  fixes: ['virtual-controller.installDriver'],
  async run(_params, ctx) {
    const service = await ctx.ports.services.get(DRIVER_SERVICE);
    if (!service.ok) {
      return {
        pass: false,
        error: true,
        summary: `Could not read the services: ${service.error.message}`,
      };
    }
    if (!service.value) {
      return {
        pass: false,
        summary: 'The ViGEmBus driver is not installed',
        details: [
          'A virtual controller needs it. You install it yourself; RigReady never installs drivers.',
        ],
      };
    }
    if (service.value.state !== 'running') {
      return {
        pass: false,
        summary: `The ViGEmBus driver is installed but ${service.value.state}`,
        details: ['Restarting Windows usually starts it.'],
      };
    }
    return { pass: true, summary: 'The ViGEmBus driver is installed and running' };
  },
};

export const installDriverInstructions: RemediationDefinition<Record<string, never>> = {
  type: 'virtual-controller.installDriver',
  label: 'Install the virtual controller driver',
  order: 900,
  kind: 'instructions',
  params: z.object({}).strict() as z.ZodType<Record<string, never>>,
  describe: () => 'Install the ViGEmBus driver',
  instructions: () =>
    [
      'RigReady never installs drivers. To install this one yourself:',
      '',
      `1. Download the setup from the [ViGEmBus releases page](${DRIVER_DOWNLOAD}) (\`ViGEmBus_1.22.0_x64_x86_arm64.exe\`, by Nefarius Software Solutions).`,
      '2. Run it and accept the prompt Windows shows; it asks for administrator rights itself.',
      '3. Restart Windows if the setup asks you to, then check again.',
    ].join('\n'),
  async run() {
    return err('instructions.only', 'This fix only shows instructions; you do the steps.');
  },
};

export const StartParamsSchema = z.object({
  /** The id of a virtual controller profile (Configure > Virtual controller). */
  profile: z.string().regex(PROFILE_ID),
  /** Hide the real controllers from games with HidHide until Stand down. */
  hideControllers: z.boolean().default(false),
});
export type StartParams = z.infer<typeof StartParamsSchema>;

export function startRemediation(
  emulator: () => Emulator,
  store: ProfileStore
): RemediationDefinition<StartParams> {
  return {
    type: 'virtual-controller.start',
    label: 'Start a virtual controller',
    order: 160,
    params: StartParamsSchema,
    describe: (p) =>
      `Start the virtual controller "${p.profile}"${p.hideControllers ? ', hiding the real controllers from games' : ''}`,
    async run(params, ctx) {
      const profile = await store.get(params.profile);
      if (!profile.ok) return profile;
      const started = await emulator().start(profile.value, {
        hide: params.hideControllers,
        by: 'setup',
        ...(ctx.profile ? { setup: ctx.profile.name } : {}),
      });
      if (!started.ok) return started;
      const kind = started.value.kind === 'ds4' ? 'DualShock 4' : 'Xbox 360 controller';
      const hidden =
        started.value.hidden.length > 0
          ? `; hidden from games: ${started.value.hidden.join(', ')}`
          : '';
      return ok(`Virtual controller on: ${started.value.profileName} (${kind})${hidden}`);
    },
  };
}

export function stopRemediation(
  emulator: () => Emulator
): RemediationDefinition<Record<string, never>> {
  return {
    type: 'virtual-controller.stop',
    label: 'Stop the virtual controller',
    order: 160,
    params: z.object({}).strict() as z.ZodType<Record<string, never>>,
    describe: () => 'Stop the virtual controller and show the real controllers to games again',
    async run() {
      const stopped = await emulator().stop();
      if (!stopped.ok) return stopped;
      return ok(stopped.value ?? 'No virtual controller was running');
    },
  };
}

/** Stand down stops a virtual controller that a setup started; one started by hand stays. */
export function standDownStep(emulator: () => Emulator): StandDownStep {
  return {
    id: 'virtual-controller.stop',
    label: 'Virtual controller',
    order: 50,
    async run() {
      const running = emulator().current();
      if (!running || running.by !== 'setup') return ok(null);
      return emulator().stop();
    },
  };
}
