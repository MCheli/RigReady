import { z } from 'zod';
import type { CaptureDefinition, CheckDefinition } from '../../../core/checks/registry';
import { ok } from '../../../core/result';
import type { ServiceInfo } from '../../../shared/models';

export const SERVICE_RUNNING = 'service.running';

export const ServiceParamsSchema = z.object({
  /** The service's short name, e.g. "HidHide" or "Audiosrv". Case-insensitive. */
  name: z.string().min(1),
});
export type ServiceParams = z.infer<typeof ServiceParamsSchema>;

const STATES: Record<ServiceInfo['state'], string> = {
  running: 'Running',
  stopped: 'Stopped',
  starting: 'Start pending',
  stopping: 'Stop pending',
  paused: 'Paused',
  other: 'Not running',
};

export const serviceRunningCheck: CheckDefinition<ServiceParams> = {
  type: SERVICE_RUNNING,
  group: 'apps',
  label: 'Windows service running',
  params: ServiceParamsSchema,
  // Starting a service needs admin rights; the fix is to tell the user how.
  fixes: ['instructions.show', 'script.run'],
  async run(params, ctx) {
    const service = await ctx.ports.services.get(params.name);
    if (!service.ok) return { pass: false, error: true, summary: service.error.message };
    if (!service.value) return { pass: false, summary: 'Not installed' };
    const state = STATES[service.value.state];
    const details =
      service.value.displayName && service.value.displayName !== service.value.name
        ? [service.value.displayName]
        : [];
    return { pass: service.value.state === 'running', summary: state, details };
  },
};

/** Services sim rigs depend on, offered in the capture when they are installed. */
const KNOWN_SERVICES: Record<string, string> = {
  hidhide: 'HidHide',
  vigembus: 'ViGEm Bus',
  fanatecservice: 'Fanatec service',
  npservice: 'NaturalPoint service',
};

export const serviceCapture: CaptureDefinition = {
  id: 'services',
  label: 'Services',
  async capture(ctx) {
    const services = await ctx.ports.services.list();
    if (!services.ok) return services;
    return ok(
      services.value
        .filter((s) => KNOWN_SERVICES[s.name.toLowerCase()] !== undefined && s.state === 'running')
        .map((s) => {
          const title = KNOWN_SERVICES[s.name.toLowerCase()]!;
          return {
            key: `service:${s.name.toLowerCase()}`,
            group: 'apps' as const,
            title,
            description: `Windows service ${s.name} (${s.displayName})`,
            selectedByDefault: false,
            check: { type: SERVICE_RUNNING, title, required: true, params: { name: s.name } },
          };
        })
    );
  },
};
