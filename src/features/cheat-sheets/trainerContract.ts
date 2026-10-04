import { z } from 'zod';
import { channel } from '../../shared/ipc';
import { AircraftProgressSchema, TrainerCardSchema } from './core/trainer';

/**
 * The channels of "Learn your controls", kept apart from the rest of the cheat sheets'
 * contract and spread into it there.
 */

const aircraft = z.object({
  game: z.string().min(1).max(40),
  aircraftId: z.string().min(1).max(200),
});

export const TrainerDeckSchema = z.object({
  aircraft: z.object({ id: z.string(), name: z.string() }),
  gameName: z.string(),
  /** Every action there is to learn on the controllers that are attached. */
  cards: z.array(TrainerCardSchema),
  /** The devices those cards are on, for "practise only this device". */
  devices: z.array(z.object({ key: z.string(), title: z.string(), cards: z.number().int() })),
  /** Devices of the sheet that are not attached, so their controls are left out. */
  unplugged: z.array(z.string()),
  progress: AircraftProgressSchema,
});
export type TrainerDeck = z.infer<typeof TrainerDeckSchema>;

export const trainerChannels = {
  /** The cards of one aircraft and what is remembered about them. */
  trainerDeck: channel(aircraft, TrainerDeckSchema),
  /**
   * Keeps answers (and, with `finished`, a round played to the end) under the data root.
   * Answers with the progress as it is in the file afterwards.
   */
  trainerRecord: channel(
    aircraft.extend({
      answers: z
        .array(z.object({ cardId: z.string().min(1).max(300), right: z.boolean() }))
        .max(500),
      finished: z.boolean().default(false),
    }),
    AircraftProgressSchema
  ),
};
