import { z } from 'zod';
import { channel, defineContract, noInput } from './ipc';
import { InputStateSchema } from './models';

/** The shell's own contract: facts about this run of the app. */
export const appContract = defineContract(
  'app',
  {
    info: channel(
      noInput,
      z.object({
        version: z.string(),
        /** Set when the app runs on fixture-backed providers instead of the real machine. */
        scenario: z.string().optional(),
        dataRoot: z.string(),
        features: z.array(z.string()),
        /** Things the user should be told once, e.g. that an unreadable settings file was replaced. */
        notices: z.array(z.string()).default([]),
      })
    ),
    /**
     * Scenario runs only: changes the fake machine while the app is running (mutations as
     * in a scenario file) and delivers controller input. Fails on the real machine.
     */
    scenario: channel(
      z.object({
        mutations: z.array(z.unknown()).default([]),
        input: z.array(InputStateSchema).default([]),
        /**
         * Files changed through FileStore as one journaled action, as a feature would
         * (paths below the fake user folder). For demonstrating the Safety page.
         */
        change: z
          .object({
            reason: z.string(),
            files: z.array(z.object({ path: z.string(), content: z.string() })),
          })
          .optional(),
        /** Shows real on-screen labels (the Identify overlay) for a moment. */
        labels: z
          .object({
            durationMs: z.number().int(),
            items: z.array(
              z.object({
                x: z.number(),
                y: z.number(),
                width: z.number(),
                height: z.number(),
                text: z.string(),
                caption: z.string().optional(),
              })
            ),
          })
          .optional(),
        /** Renders HTML through the Render port and reports what came back. */
        render: z
          .object({ html: z.string(), width: z.number().int(), height: z.number().int() })
          .optional(),
      }),
      z.object({
        applied: z.number().int(),
        render: z
          .object({
            pngBytes: z.number().int(),
            pngWidth: z.number().int(),
            pngHeight: z.number().int(),
            pdfBytes: z.number().int(),
            pdfHeader: z.string(),
          })
          .optional(),
      })
    ),
  },
  {
    /** Something outside the renderer changed the machine (tray action, live scenario mutation). */
    machineChanged: z.object({ reason: z.string() }),
  }
);
