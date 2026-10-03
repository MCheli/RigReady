import { z } from 'zod';
import type {
  CaptureCandidate,
  CaptureDefinition,
  CheckDefinition,
} from '../../../core/checks/registry';
import type { GameRegistry } from '../../../core/games';
import { ok } from '../../../core/result';
import type { RacingOverview } from '../contract';
import { RACING_GAMES, installOf, type RacingContext } from './context';
import { beamngView } from './beamng/beamng';
import { acView } from './assettoCorsa';
import { fanatecBases, WHEEL_BASE, wheelStatus } from './fanatec/fanatec';
import { WHEEL_SETTINGS } from './fanatec/wheelSettings';
import { iracingView } from './iracing/iracing';
import { lmuView } from './lmu/lmu';
import { helperApps } from './software';

/** Check types, the racing capture and the overview. */

export const IRACING_DEVICES = 'racing.iracingDevices';
export const IRACING_SERVICE = 'racing.iracingService';

export function iracingDevicesCheck(games: GameRegistry): CheckDefinition<Record<string, never>> {
  return {
    type: IRACING_DEVICES,
    group: 'files',
    label: 'iRacing knows the connected controllers',
    params: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
    async run(_params, ctx) {
      const view = await iracingView({ ...ctx, games });
      if (!view.userFolder)
        return { pass: false, summary: 'The iRacing folder in Documents was not found' };
      if (!view.calibrationFound && !view.controlsFound) {
        return { pass: false, summary: 'iRacing has no bindings or calibration yet' };
      }
      const moved = view.devices.filter((d) => d.state === 'moved');
      const missing = view.devices.filter((d) => d.state === 'missing');
      if (moved.length > 0) {
        return {
          pass: false,
          summary: `${moved.map((d) => d.name).join(', ')}: new Windows id, iRacing will ask to recalibrate`,
          details: ['Open Configure › Racing › iRacing to point iRacing at the new id.'],
        };
      }
      if (missing.length > 0) {
        return { pass: false, summary: `Not connected: ${missing.map((d) => d.name).join(', ')}` };
      }
      const n = view.devices.length;
      return {
        pass: true,
        summary:
          n === 1
            ? 'The controller iRacing uses is connected'
            : `All ${n} controllers iRacing uses are connected`,
      };
    },
  };
}

export const iracingServiceCheck: CheckDefinition<Record<string, never>> = {
  type: IRACING_SERVICE,
  group: 'apps',
  label: 'iRacing helper service running',
  params: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  async run(_params, ctx) {
    const service = await ctx.ports.services.get('iRacingService');
    if (!service.ok) return { pass: false, summary: service.error.message };
    if (!service.value) return { pass: false, summary: 'Not installed' };
    if (service.value.state === 'running') return { pass: true, summary: 'Running' };
    return {
      pass: false,
      summary: 'Not running',
      details: [
        'Start it from Windows Services ("iRacing.com Helper Service"); this needs administrator rights.',
      ],
    };
  },
};

/** What capture proposes for a racing setup, beyond the devices, apps and monitors the other captures list. */
export function racingCapture(games: GameRegistry): CaptureDefinition {
  return {
    id: 'racing',
    label: 'Racing',
    async capture(checkCtx) {
      const ctx: RacingContext = { ...checkCtx, games };
      const candidates: CaptureCandidate[] = [];
      const devices = await ctx.ports.devices.list();
      const base = devices.ok ? fanatecBases(devices.value)[0] : undefined;
      // A rig set up for racing: the wheel is connected and no other game controllers
      // (flight sticks, panels) are. Only then are racing items kept by default; with the
      // flight gear plugged in they are offered, and the user decides.
      const racingRig =
        base !== undefined &&
        devices.ok &&
        !devices.value.some((d) => d.isGameController && !d.isHub && d.vendorId !== base.vendorId);
      if (base) {
        candidates.push({
          key: 'racing:wheel-base',
          group: 'devices',
          title: 'Wheel base in PC mode',
          description: `${base.name || 'Fanatec wheel base'} · warns when it is in compatibility (yellow) mode`,
          selectedByDefault: racingRig,
          check: {
            type: WHEEL_BASE,
            title: 'Wheel base in PC mode',
            required: true,
            params: { vendorId: base.vendorId, productId: base.productId },
          },
        });
      }
      for (const app of await helperApps(ctx)) {
        if (!app.exe) continue;
        candidates.push({
          key: `racing:app:${app.id}`,
          group: 'apps',
          title: app.name,
          description: `For ${app.purpose}${app.running ? ' · running now' : ' · not running now'}`,
          // Kept by default when it is running now: the rig is working, so it is part of the setup.
          selectedByDefault: racingRig && app.running,
          program: app.process,
          check: {
            type: 'process.running',
            title: app.name,
            required: true,
            params: { name: app.process, stopOnStandDown: false },
            remediation: { type: 'process.launch', params: { exe: app.exe, args: [] } },
          },
        });
      }
      if (!racingRig) return ok(candidates);
      if (await installOf(ctx, 'iracing')) {
        const service = await ctx.ports.services.get('iRacingService');
        if (service.ok && service.value) {
          candidates.push({
            key: 'racing:iracing-service',
            game: 'iracing',
            group: 'apps',
            title: 'iRacing helper service',
            description: 'For an iRacing setup: iRacing needs it to start a session',
            selectedByDefault: false,
            check: {
              type: IRACING_SERVICE,
              title: 'iRacing helper service',
              required: true,
              params: {},
            },
          });
        }
        const view = await iracingView(ctx);
        if (view.devices.length > 0) {
          candidates.push({
            key: 'racing:iracing-devices',
            game: 'iracing',
            group: 'files',
            title: 'iRacing knows the wheel',
            description: 'For an iRacing setup: warns before iRacing asks you to calibrate again',
            selectedByDefault: false,
            check: {
              type: IRACING_DEVICES,
              title: 'iRacing knows the wheel',
              required: true,
              params: {},
            },
          });
        }
      }
      for (const [game, name] of [
        ['lmu', 'Le Mans Ultimate'],
        ['beamng', 'BeamNG.drive'],
      ] as const) {
        if (!(await installOf(ctx, game))) continue;
        candidates.push({
          key: `racing:wheel-settings:${game}`,
          game,
          group: 'other',
          title: `${name} wheel settings as recommended`,
          description:
            'Compares the in-game force feedback settings RigReady can read with the recommendations',
          selectedByDefault: false,
          check: {
            type: WHEEL_SETTINGS,
            title: `${name} wheel settings`,
            required: false,
            params: { game },
          },
        });
      }
      return ok(candidates);
    },
  };
}

export async function racingOverview(ctx: RacingContext): Promise<RacingOverview> {
  const wheel = await wheelStatus(ctx);
  const apps = (await helperApps(ctx)).map(({ id, name, purpose, installed, running }) => ({
    id,
    name,
    purpose,
    installed,
    running,
  }));
  const games: RacingOverview['games'] = [];
  for (const game of RACING_GAMES) {
    const module = ctx.games.get(game.id);
    const install = await installOf(ctx, game.id);
    let version: string | undefined;
    let updatePending = false;
    if (install && module?.installedVersion) {
      const v = await module.installedVersion(ctx, install);
      if (v.ok) {
        version = v.value.version;
        updatePending = v.value.updatePending === true;
      }
    }
    let bindings = 'Not installed';
    let attention = false;
    let running = false;
    if (install) {
      if (game.id === 'iracing') {
        const view = await iracingView(ctx);
        running = view.running;
        const moved = view.devices.filter((d) => d.state === 'moved').length;
        const missing = view.devices.filter((d) => d.state === 'missing').length;
        attention = moved + missing > 0;
        bindings = !view.controlsFound
          ? 'No bindings yet'
          : moved > 0
            ? `${moved} controller${moved === 1 ? ' has' : 's have'} a new Windows id`
            : missing > 0
              ? `${missing} controller${missing === 1 ? '' : 's'} not connected`
              : `${view.bindings.length} bindings · controllers connected`;
      } else if (game.id === 'lmu') {
        const view = await lmuView(ctx);
        running = view.running;
        const off = view.devices.filter(
          (d) => d.state === 'missing' || d.state === 'other-mode'
        ).length;
        attention = off > 0;
        bindings =
          view.bindings.length === 0
            ? 'No bindings yet'
            : off > 0
              ? `${off} controller${off === 1 ? '' : 's'} not connected`
              : `${view.bindings.length} bindings · controllers connected`;
      } else if (game.id === 'beamng') {
        const view = await beamngView(ctx);
        running = view.running;
        const joysticks = view.maps.filter((m) => m.state !== 'keyboard');
        const off = joysticks.filter(
          (m) => m.state === 'missing' || m.state === 'other-mode'
        ).length;
        attention = off > 0;
        bindings =
          joysticks.length === 0
            ? 'Default bindings'
            : off > 0
              ? `${off} controller map${off === 1 ? '' : 's'} for a controller not connected`
              : `${joysticks.length} controller map${joysticks.length === 1 ? '' : 's'} · connected`;
      } else {
        const view = await acView(ctx);
        running = view.running;
        const off = view.controllers.filter(
          (c) => c.used && c.state !== 'connected' && c.state !== 'unknown'
        ).length;
        attention = off > 0;
        bindings =
          view.bindings.length === 0
            ? 'No bindings yet'
            : off > 0
              ? `${off} controller${off === 1 ? '' : 's'} not found under the stored id`
              : `${view.bindings.length} bindings · controllers connected`;
      }
    }
    games.push({
      id: game.id,
      name: game.name,
      installed: install !== undefined,
      running,
      ...(version ? { version } : {}),
      updatePending,
      bindings,
      attention,
    });
  }
  return { wheel, apps, games };
}
