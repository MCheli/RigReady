import type { MainContext } from '../../core/feature';
import { ok, type Result } from '../../core/result';
import type { Sheet } from './core/sheet';
import { trainerCards, type AircraftProgress } from './core/trainer';
import { TrainerStore } from './core/trainerStore';
import type { TrainerDeck } from './trainerContract';

/**
 * The main side of "Learn your controls": builds the cards from the same sheet the cheat
 * sheets show (so it asks exactly what the game has bound), with plain-language labels where
 * a feature registered them, and keeps the progress per aircraft under the data root.
 */
export function trainerHandlers(
  ctx: Pick<MainContext, 'ports' | 'bindings'>,
  service: { sheet(game: string, aircraftId: string): Promise<Result<Sheet>> }
) {
  const store = new TrainerStore(ctx.ports.files, ctx.ports.folders);
  return {
    async trainerDeck(input: { game: string; aircraftId: string }): Promise<Result<TrainerDeck>> {
      const sheet = await service.sheet(input.game, input.aircraftId);
      if (!sheet.ok) return sheet;
      const progress = await store.progress(input.game, input.aircraftId);
      if (!progress.ok) return progress;
      const cards = trainerCards(
        sheet.value,
        await ctx.bindings.labels(input.game, input.aircraftId)
      );
      const devices = sheet.value.devices
        .map((d) => ({
          key: d.key,
          title: d.title,
          cards: cards.filter((c) => c.answers.some((a) => a.deviceKey === d.key)).length,
        }))
        .filter((d) => d.cards > 0);
      return ok({
        aircraft: { id: sheet.value.aircraft.id, name: sheet.value.aircraft.name },
        gameName: sheet.value.gameName,
        cards,
        devices,
        unplugged: sheet.value.devices
          .filter((d) => !d.connected && d.counts.bound > 0)
          .map((d) => d.title),
        progress: progress.value,
      });
    },

    trainerRecord(input: {
      game: string;
      aircraftId: string;
      answers: { cardId: string; right: boolean }[];
      finished: boolean;
    }): Promise<Result<AircraftProgress>> {
      return store.record(
        input.game,
        input.aircraftId,
        input.answers,
        input.finished,
        ctx.ports.clock.now().toISOString()
      );
    },
  };
}
