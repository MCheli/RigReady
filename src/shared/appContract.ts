import { z } from 'zod';
import { channel, defineContract, noInput } from './ipc';
import { InputStateSchema } from './models';

/** One thing a command did or is doing: a fix of Make ready, a step of Launch. */
export const CommandStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  state: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
  message: z.string().optional(),
});
export type CommandStep = z.infer<typeof CommandStepSchema>;

/**
 * A command RigReady was started with (`--fly`, `--make-ready`, `--setup`: a desktop
 * shortcut, a Jump List task, the hotkey), as far as it has got. The shell runs it; the
 * window shows it.
 */
export const CommandRunSchema = z.object({
  /** Counts up with every command, so the window can tell a new one from news about the same one. */
  id: z.number().int(),
  action: z.enum(['fly', 'makeReady', 'select']),
  /** The setup as it was asked for: an id or a name. Empty when the command named none. */
  asked: z.string(),
  /** The setup that was meant, once it is found. */
  setup: z.object({ id: z.string(), name: z.string() }).optional(),
  phase: z.enum(['checking', 'makingReady', 'launching', 'finished']),
  /** How it ended. Absent while it is still going. */
  outcome: z.enum(['launched', 'ready', 'selected', 'stopped', 'cancelled']).optional(),
  /** ok: done as asked. warn: needs a look. bad: not ready, or it failed. idle: nothing to judge. */
  tone: z.enum(['ok', 'warn', 'bad', 'idle']),
  /** One line: what is happening, or what happened. */
  headline: z.string(),
  /** Why it stopped, or what to know about how it ended, one line each. */
  reasons: z.array(z.string()),
  steps: z.array(CommandStepSchema),
  /** True while "Do not launch" can still keep the game from being started. */
  canCancel: z.boolean(),
});
export type CommandRun = z.infer<typeof CommandRunSchema>;

/** The shell's own contract: facts about this run of the app. */
export const appContract = defineContract(
  'app',
  {
    /** The command of this start, or the last one handed over by a second start. Null: there was none. */
    command: channel(noInput, CommandRunSchema.nullable()),
    /**
     * Keeps a `--fly` command that is still checking or making ready from launching the
     * game. Answers false when it is too late (the launch has begun) or nothing is running.
     */
    cancelCommand: channel(noInput, z.object({ cancelled: z.boolean() })),
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
    /** A command started, got further or ended. */
    command: CommandRunSchema,
  }
);
