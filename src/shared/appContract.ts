import { z } from 'zod';
import { channel, defineContract, noInput } from './ipc';

/** The shell's own contract: facts about this run of the app. */
export const appContract = defineContract('app', {
  info: channel(
    noInput,
    z.object({
      version: z.string(),
      /** Set when the app runs on fixture-backed providers instead of the real machine. */
      scenario: z.string().optional(),
      dataRoot: z.string(),
      features: z.array(z.string()),
    })
  ),
});
