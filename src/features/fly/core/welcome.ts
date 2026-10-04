import type { MainContext } from '../../../core/feature';
import type { Welcome } from '../contract';

type Ctx = Pick<MainContext, 'ports' | 'games' | 'log'>;

/**
 * What the first-run screen says RigReady found on this PC, before any setup exists:
 * the games, the game controllers and the monitors. Read-only, and never an error: a
 * provider that fails just leaves its part out.
 */
export async function welcome(ctx: Ctx): Promise<Welcome> {
  const games: Welcome['games'] = [];
  for (const module of ctx.games.all()) {
    try {
      const installs = await module.detect(ctx);
      if (installs.ok && installs.value.length > 0) {
        games.push({
          id: module.id,
          name: module.name,
          ...(module.kind ? { kind: module.kind } : {}),
        });
      }
    } catch (e) {
      ctx.log.error(`detect ${module.id} threw`, e);
    }
  }
  const devices = await ctx.ports.devices.list();
  const controllers = devices.ok
    ? devices.value.filter((d) => d.isGameController && !d.isHub).map((d) => d.name)
    : [];
  const displays = await ctx.ports.displays.read();
  const monitors = displays.ok ? displays.value.displays : [];
  return {
    games,
    controllers,
    monitors: { connected: monitors.length, on: monitors.filter((m) => m.enabled).length },
  };
}
