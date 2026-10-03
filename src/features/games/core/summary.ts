import type { CheckContext } from '../../../core/checks/registry';
import type { GameRegistry } from '../../../core/games';
import type { GameSummary } from '../contract';

/** Asks every game module what it finds on this machine. One module failing does not hide the others. */
export async function summarizeGames(
  games: GameRegistry,
  ctx: CheckContext
): Promise<GameSummary[]> {
  const summaries: GameSummary[] = [];
  for (const module of games.all()) {
    const summary: GameSummary = {
      id: module.id,
      name: module.name,
      installs: [],
      configLocations: [],
      problems: [],
    };
    try {
      const installs = await module.detect(ctx);
      if (installs.ok) summary.installs = installs.value;
      else summary.problems.push(installs.error.message);
      const locations = await module.configLocations(ctx);
      if (locations.ok) summary.configLocations = locations.value;
      else summary.problems.push(locations.error.message);
    } catch (e) {
      ctx.log.error(`game module ${module.id} threw`, e);
      summary.problems.push(e instanceof Error ? e.message : String(e));
    }
    summaries.push(summary);
  }
  return summaries;
}
