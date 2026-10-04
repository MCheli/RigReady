import { z } from 'zod';
import type {
  CaptureDefinition,
  CheckContext,
  CheckDefinition,
  RemediationDefinition,
} from '../../../core/checks/registry';
import { ok } from '../../../core/result';
import { profileFolderName } from './aircraft';
import type { DcsBindings } from './bindings';
import { scanMigration } from './migration';

/**
 * The Fly check "DCS bindings present and matching connected devices": the aircraft has
 * binding files, and none of them sits under a device id that Windows has since
 * replaced (the "my bindings are gone" situation). Its fix opens the migration screen,
 * where every rename is previewed before it is made.
 */

export const BINDINGS_CHECK = 'dcs-bindings.deviceIds';
export const OPEN_MIGRATION = 'dcs-bindings.openMigration';

export const BindingsCheckParamsSchema = z.object({
  /** The aircraft's input profile: FA-18C_hornet, UH-1H. */
  aircraft: z.string().min(1),
  /** Shown in messages: "F/A-18C". */
  aircraftName: z.string().optional(),
});
export type BindingsCheckParams = z.infer<typeof BindingsCheckParamsSchema>;

export function createBindingsCheck(
  bindings: (ctx?: CheckContext) => DcsBindings
): CheckDefinition<BindingsCheckParams> {
  return {
    type: BINDINGS_CHECK,
    group: 'files',
    label: 'DCS bindings match the connected devices',
    params: BindingsCheckParamsSchema,
    async run(params, ctx) {
      // A setup that names its DCS install has its bindings checked in that install's folder.
      const service = bindings(ctx);
      if (service.ctx.install && !(await service.locations()).installDir) {
        return {
          pass: false,
          error: true,
          summary: 'DCS install not found',
          details: [`This setup uses the DCS install at ${service.ctx.install}, which is gone.`],
        };
      }
      const label = params.aircraftName ?? params.aircraft;
      const scan = await scanMigration(service);
      if (!scan.ok) return { pass: false, summary: scan.error.message };
      const folder = profileFolderName(params.aircraft).toLowerCase();
      const mine = (files: { folder: string }[]): boolean =>
        files.some((f) => f.folder.toLowerCase() === folder);
      const stale = scan.value.orphans.filter((o) => o.status !== 'unplugged' && mine(o.files));
      if (stale.length > 0) {
        return {
          pass: false,
          summary:
            stale.length === 1
              ? `Bindings for ${stale[0]!.name} belong to an old device ID`
              : `Bindings for ${stale.length} devices belong to old device IDs`,
          details: stale.map(
            (o) => `Bindings for ${o.name} belong to an old device ID (${o.oldGuid})`
          ),
        };
      }
      const view = await service.view(params.aircraft);
      if (!view.ok) return { pass: false, summary: view.error.message };
      const withFiles = view.value.devices.filter(
        (d) => d.type === 'joystick' && d.connected && d.file.source === 'user'
      );
      if (withFiles.length === 0) {
        return {
          pass: false,
          summary: `No bindings of your own for ${label} on the connected devices`,
        };
      }
      return {
        pass: true,
        summary: `${withFiles.length} connected ${withFiles.length === 1 ? 'device has' : 'devices have'} bindings for ${label}`,
      };
    },
  };
}

export function createOpenMigration(
  open: () => void
): RemediationDefinition<Record<string, never>> {
  return {
    type: OPEN_MIGRATION,
    label: 'Review device ID changes',
    // Opens the previewed migration; nothing is moved until the user applies it there.
    kind: 'navigate',
    order: 400,
    params: z.object({}).strict() as z.ZodType<Record<string, never>>,
    describe: () => 'Open Bindings → Device IDs to move the bindings to the current device IDs',
    async run() {
      open();
      return ok('Opened Bindings → Device IDs. Review the preview there and apply it.');
    },
  };
}

/** Proposes the check for every aircraft that has binding files of its own right now. */
export function createBindingsCapture(bindings: () => DcsBindings): CaptureDefinition {
  return {
    id: 'dcs-bindings',
    label: 'DCS bindings',
    async capture() {
      const service = bindings();
      const overview = await service.overview();
      if (!overview.ok) return overview;
      return ok(
        overview.value.aircraft
          .filter((a) => a.userFiles > 0)
          // The aircraft with the most of the user's own bindings is the likeliest setup.
          .sort((a, b) => b.userFiles - a.userFiles || a.name.localeCompare(b.name))
          .map((a) => {
            const title = `DCS bindings match devices (${a.name})`;
            return {
              key: `dcs-bindings:${a.id}`,
              game: 'dcs',
              variant: { id: a.id, name: a.name, setupName: `DCS ${a.name}` },
              icon: 'mdi-controller',
              group: 'files' as const,
              title,
              description: `${a.userFiles} binding ${a.userFiles === 1 ? 'file' : 'files'}; warns when Windows has changed a device ID and DCS no longer finds them`,
              selectedByDefault: true,
              check: {
                type: BINDINGS_CHECK,
                title,
                // A warning, not a blocker: DCS still starts, on default bindings.
                required: false,
                params: { aircraft: a.id, aircraftName: a.name },
                remediation: { type: OPEN_MIGRATION, params: {} },
              },
            };
          })
      );
    },
  };
}
