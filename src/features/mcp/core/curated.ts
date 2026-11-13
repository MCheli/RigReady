import { z } from 'zod';
import { isStoredAssistantScript } from '../../../core/assistantScripts';
import { resolveSetup } from '../../../core/commandLine';
import type { McpCallContext, McpToolDefinition } from '../../../core/mcp';
import { err, ok, type Result } from '../../../core/result';
import type { Envelope } from '../../../shared/ipc';
import { readManualPage, searchManual, webUrl, type ManualPage } from './manual';

/**
 * The task-level tools the mcp feature offers itself: what a user does on the Play screen
 * and the Setups page, through the same channels, with the defaults a user would pick.
 * Every one answers with what the channel answered, never with a word of its own.
 */

const unwrap = <T>(envelope: Envelope): Result<T> =>
  envelope.ok ? ok(envelope.value as T) : envelope;

interface Setup {
  id: string;
  name: string;
  game?: string;
  gameName?: string;
  lastUsed?: string;
  canLaunch: boolean;
}

interface FlyState {
  profiles: Setup[];
  activeProfileId?: string;
}

interface Item {
  itemId: string;
  type: string;
  title: string;
  group: string;
  required: boolean;
  status: string;
  summary: string;
  details: string[];
  fix?: string;
  fixKind?: string;
  instructions?: string;
  confirm?: { exe: string; args: string[] };
  disabled?: boolean;
}

interface Report {
  profileId: string;
  ready: boolean;
  failed: number;
  warnings: number;
  fixable: number;
  results: Item[];
}

interface Step {
  itemId: string;
  title: string;
  ok: boolean;
  message: string;
  skipped?: boolean;
}

const SetupArg = z
  .string()
  .max(120)
  .describe('The setup, by name or id ("DCS F/A-18C", "dcs-f-a-18c"). Left out: the setup in use.');

/** The setup a tool means: the one asked for, or the one in use. */
async function targetSetup(ctx: McpCallContext, asked?: string): Promise<Result<Setup>> {
  const state = unwrap<FlyState>(await ctx.invoke('fly:state'));
  if (!state.ok) return state;
  if (asked !== undefined && asked.trim() !== '') {
    const found = resolveSetup(asked, state.value.profiles);
    if (!found.ok) {
      const names = state.value.profiles.map((p) => `${p.name} (${p.id})`).join(', ');
      return err('mcp.setup', found.message, names ? `Setups on this PC: ${names}.` : undefined);
    }
    return ok(found.setup);
  }
  const active = state.value.profiles.find((p) => p.id === state.value.activeProfileId);
  if (!active) {
    return err(
      'mcp.setup',
      state.value.profiles.length === 0
        ? 'There is no setup yet. Create one with setup_create_from_rig.'
        : 'No setup is in use. Name one.',
      state.value.profiles.map((p) => `${p.name} (${p.id})`).join(', ') || undefined
    );
  }
  return ok(active);
}

/**
 * A setup as a question names it: by its name, whichever way the assistant named it. One
 * that cannot be found is named as it was asked for; the call then says why it cannot run.
 */
async function setupLabel(ctx: McpCallContext, asked?: string): Promise<string> {
  const setup = await targetSetup(ctx, asked);
  if (setup.ok) return setup.value.name;
  return asked !== undefined && asked.trim() !== '' ? `"${asked.trim()}"` : 'the setup in use';
}

const ItemOut = z.object({
  itemId: z.string(),
  title: z.string(),
  group: z.string(),
  required: z.boolean(),
  status: z.string(),
  summary: z.string(),
  fix: z.string().optional(),
  fixKind: z.string().optional(),
  needsConfirmation: z.boolean().optional(),
  disabled: z.boolean().optional(),
});

const ReportOut = z.object({
  setup: z.object({ id: z.string(), name: z.string() }),
  ready: z.boolean(),
  failed: z.number().int(),
  warnings: z.number().int(),
  fixable: z.number().int(),
  items: z.array(ItemOut),
});

const summarize = (report: Report, setup: Setup) => ({
  setup: { id: setup.id, name: setup.name },
  ready: report.ready,
  failed: report.failed,
  warnings: report.warnings,
  fixable: report.fixable,
  items: report.results.map((r) => ({
    itemId: r.itemId,
    title: r.title,
    group: r.group,
    required: r.required,
    status: r.status,
    summary: r.summary,
    ...(r.fix ? { fix: r.fix } : {}),
    ...(r.fixKind ? { fixKind: r.fixKind } : {}),
    ...(r.confirm ? { needsConfirmation: true } : {}),
    ...(r.disabled ? { disabled: true } : {}),
  })),
});

const StepOut = z.object({
  itemId: z.string(),
  title: z.string(),
  ok: z.boolean(),
  message: z.string(),
  skipped: z.boolean().optional(),
});

export function builtinTools(deps: { manual(): ManualPage[] }): McpToolDefinition[] {
  const tools: McpToolDefinition[] = [];
  const add = <I extends z.ZodType, O extends z.ZodType>(tool: McpToolDefinition<I, O>): void => {
    tools.push(tool as unknown as McpToolDefinition);
  };

  add({
    name: 'setups_list',
    title: 'List the setups',
    description:
      'Every setup on this PC (one per aircraft or car): id, name, game, when it was last used, whether it can launch, and which one the Play screen shows now. Use the id or the name with the other tools.',
    input: z.object({}),
    output: z.object({
      setups: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          game: z.string().optional(),
          gameName: z.string().optional(),
          lastUsed: z.string().optional(),
          canLaunch: z.boolean(),
          inUse: z.boolean(),
        })
      ),
    }),
    tier: 'read',
    run: async (_input, ctx) => {
      const state = unwrap<FlyState>(await ctx.invoke('fly:state'));
      if (!state.ok) return state;
      return ok({
        setups: state.value.profiles.map((p) => ({
          ...p,
          inUse: p.id === state.value.activeProfileId,
        })),
      });
    },
  });

  add({
    name: 'rig_check',
    title: 'Check the rig',
    description:
      'Runs the checklist of a setup against the rig as it is now and answers with every item: devices connected, apps running, monitors, audio, files; met or not, with what its fix would do. Does not change anything. With select, the setup also becomes the one the Play screen shows.',
    input: z.object({
      setup: SetupArg.optional(),
      select: z.boolean().default(false).describe('Make it the setup in use on the Play screen.'),
    }),
    output: ReportOut,
    tier: 'read',
    summarize: async (input, ctx) => `Check ${await setupLabel(ctx, input.setup)}`,
    run: async (input, ctx) => {
      const setup = await targetSetup(ctx, input.setup);
      if (!setup.ok) return setup;
      const report = unwrap<Report>(
        await ctx.invoke('fly:check', { profileId: setup.value.id, remember: input.select })
      );
      if (!report.ok) return report;
      return ok(summarize(report.value, setup.value));
    },
  });

  add({
    name: 'check_explain',
    title: 'Explain one check',
    description:
      "Runs one item of a setup's checklist again and explains it: what the check looks for (its type and parameters), what it found, every detail, and what its fix would do or what the user has to do. Name the item by its title or id as rig_check listed it.",
    input: z.object({
      setup: SetupArg.optional(),
      item: z.string().max(200).describe('The item, by title or id.'),
    }),
    output: ItemOut.extend({
      type: z.string(),
      params: z.record(z.string(), z.unknown()),
      details: z.array(z.string()),
      instructions: z.string().optional(),
      program: z.string().optional(),
    }),
    tier: 'read',
    summarize: (input) => `Explain ${input.item}`,
    run: async (input, ctx) => {
      const setup = await targetSetup(ctx, input.setup);
      if (!setup.ok) return setup;
      const profile = unwrap<{
        checks: { id: string; title: string; type: string; params: Record<string, unknown> }[];
      }>(await ctx.invoke('profiles:get', { id: setup.value.id }));
      if (!profile.ok) return profile;
      const wanted = input.item.trim().toLowerCase();
      const items = profile.value.checks.filter(
        (c) => c.id.toLowerCase() === wanted || c.title.trim().toLowerCase() === wanted
      );
      if (items.length !== 1) {
        return err(
          'mcp.item',
          items.length === 0
            ? `${setup.value.name} has no item "${input.item}".`
            : `${items.length} items of ${setup.value.name} are called "${input.item}": use the id.`,
          profile.value.checks.map((c) => `${c.title} (${c.id})`).join(', ')
        );
      }
      const item = items[0]!;
      const result = unwrap<Item>(
        await ctx.invoke('fly:checkItem', { profileId: setup.value.id, itemId: item.id })
      );
      if (!result.ok) return result;
      const r = result.value;
      return ok({
        itemId: r.itemId,
        title: r.title,
        group: r.group,
        required: r.required,
        status: r.status,
        summary: r.summary,
        type: item.type,
        params: item.params,
        details: r.details,
        ...(r.fix ? { fix: r.fix } : {}),
        ...(r.fixKind ? { fixKind: r.fixKind } : {}),
        ...(r.instructions ? { instructions: r.instructions } : {}),
        ...(r.confirm
          ? { needsConfirmation: true, program: [r.confirm.exe, ...r.confirm.args].join(' ') }
          : {}),
        ...(r.disabled ? { disabled: true } : {}),
      });
    },
  });

  add({
    name: 'rig_make_ready',
    title: 'Make the rig ready',
    description:
      'Runs every available fix of a setup in the order Make ready does (start apps, apply the monitor layout, set audio, restore files), then checks again. Answers with what each step did and what is still not met. A fix that starts a program the setup names as needing confirmation runs only with approvePrograms; a script an assistant wrote is never run this way (the user runs it from RigReady). A monitor layout that was kept on this PC before is applied at once; any other reverts by itself unless the user keeps it in the RigReady window, and the call waits for that answer.',
    input: z.object({
      setup: SetupArg.optional(),
      approvePrograms: z
        .boolean()
        .default(false)
        .describe(
          'Also run the fixes that start a program the setup marked as needing confirmation.'
        ),
    }),
    output: z.object({
      setup: z.object({ id: z.string(), name: z.string() }),
      steps: z.array(StepOut),
      ready: z.boolean(),
      failed: z.number().int(),
      warnings: z.number().int(),
      needsYou: z.array(
        z.object({ title: z.string(), summary: z.string(), instructions: z.string().optional() })
      ),
    }),
    tier: 'change',
    summarize: async (input, ctx) => `Make ${await setupLabel(ctx, input.setup)} ready`,
    run: async (input, ctx) => {
      const setup = await targetSetup(ctx, input.setup);
      if (!setup.ok) return setup;
      let approved: string[] | undefined;
      if (input.approvePrograms) {
        const before = unwrap<Report>(
          await ctx.invoke('fly:check', { profileId: setup.value.id, remember: false })
        );
        if (!before.ok) return before;
        // A script an assistant wrote is never approved by an assistant: the user runs it
        // from RigReady's window, where "Run this program?" is asked first.
        approved = before.value.results
          .filter((r) => r.confirm && !isStoredAssistantScript(r.confirm.exe))
          .map((r) => r.itemId);
      }
      const made = unwrap<{
        steps: Step[];
        report: Report;
        needsYou: { title: string; summary: string; instructions?: string }[];
      }>(
        await ctx.invoke('fly:makeReady', {
          profileId: setup.value.id,
          runId: `mcp-${Date.now()}`,
          ...(approved ? { approved } : {}),
        })
      );
      if (!made.ok) return made;
      return ok({
        setup: { id: setup.value.id, name: setup.value.name },
        steps: made.value.steps,
        ready: made.value.report.ready,
        failed: made.value.report.failed,
        warnings: made.value.report.warnings,
        needsYou: made.value.needsYou,
      });
    },
  });

  add({
    name: 'rig_launch',
    title: 'Launch the game',
    description:
      "Starts the game of a setup, with the setup's pre-launch and post-launch actions. Never blocked by failing checks: check first and tell the user what is not met. Answers with the outcome (launched, paused on a failed action, failed) and the steps.",
    input: z.object({ setup: SetupArg.optional() }),
    output: z.object({
      setup: z.object({ id: z.string(), name: z.string() }),
      outcome: z.enum(['launched', 'paused', 'failed']),
      message: z.string(),
      steps: z.array(
        z.object({ phase: z.string(), title: z.string(), ok: z.boolean(), message: z.string() })
      ),
    }),
    tier: 'launch',
    summarize: async (input, ctx) => `Launch ${await setupLabel(ctx, input.setup)}`,
    run: async (input, ctx) => {
      const setup = await targetSetup(ctx, input.setup);
      if (!setup.ok) return setup;
      if (!setup.value.canLaunch) {
        return err(
          'mcp.launch',
          `${setup.value.name} has nothing to launch. Choose what Launch starts in the setup editor.`
        );
      }
      const launched = unwrap<{
        outcome: 'launched' | 'paused' | 'failed';
        message: string;
        steps: { phase: string; title: string; ok: boolean; message: string }[];
      }>(await ctx.invoke('fly:launch', { profileId: setup.value.id, runId: `mcp-${Date.now()}` }));
      if (!launched.ok) return launched;
      return ok({
        setup: { id: setup.value.id, name: setup.value.name },
        outcome: launched.value.outcome,
        message: launched.value.message,
        steps: launched.value.steps.map((s) => ({
          phase: s.phase,
          title: s.title,
          ok: s.ok,
          message: s.message,
        })),
      });
    },
  });

  add({
    name: 'rig_stand_down',
    title: 'Stand down',
    description:
      "After a session: closes the helper apps the setup marks for closing, puts the monitors back into the desk layout (at once when that layout was kept on this PC before, otherwise it reverts by itself unless the user keeps it in the RigReady window) and runs the setup's stand-down actions. With closeGame, the game is asked to close first. Answers with what each step did.",
    input: z.object({
      setup: SetupArg.optional(),
      closeGame: z
        .boolean()
        .default(false)
        .describe('Ask the game to close first, politely, never by force.'),
    }),
    output: z.object({
      setup: z.object({ id: z.string(), name: z.string() }),
      headline: z.string(),
      steps: z.array(StepOut),
    }),
    tier: 'change',
    summarize: async (input, ctx) =>
      `Stand down ${await setupLabel(ctx, input.setup)}${input.closeGame ? ' and close the game' : ''}`,
    run: async (input, ctx) => {
      const setup = await targetSetup(ctx, input.setup);
      if (!setup.ok) return setup;
      const down = unwrap<{ headline: string; steps: Step[] }>(
        await ctx.invoke('fly:standDown', { profileId: setup.value.id, closeGame: input.closeGame })
      );
      if (!down.ok) return down;
      return ok({
        setup: { id: setup.value.id, name: setup.value.name },
        headline: down.value.headline,
        steps: down.value.steps,
      });
    },
  });

  add({
    name: 'setup_create_from_rig',
    title: 'Create a setup from this rig',
    description:
      "Reads the rig as it is right now (connected game controllers, running helper apps, the monitor arrangement, the default audio devices, the game's files) and saves it as a new setup with the checks a setup like it usually keeps. Make sure everything is plugged in and running first. Answers with the setup and its checks.",
    input: z.object({
      name: z.string().trim().min(1).max(80).describe('The setup\'s name ("DCS F/A-18C").'),
      game: z
        .string()
        .max(40)
        .optional()
        .describe(
          'The game module id ("dcs", "iracing", "lmu", "beamng", "assetto-corsa", "msfs2024"). Left out: what the rig suggests, or none.'
        ),
      everything: z
        .boolean()
        .default(false)
        .describe('Keep every candidate the capture found, not only the ones kept by default.'),
    }),
    output: z.object({
      id: z.string(),
      name: z.string(),
      game: z.string().optional(),
      checks: z.array(z.object({ title: z.string(), required: z.boolean(), type: z.string() })),
      leftOut: z.array(z.string()),
      problems: z.array(z.string()),
    }),
    tier: 'change',
    summarize: (input) => `Create the setup "${input.name}" from the rig`,
    run: async (input, ctx) => {
      interface Candidate {
        key: string;
        group: string;
        title: string;
        selectedByDefault: boolean;
        game?: string;
        check: {
          type: string;
          title: string;
          required: boolean;
          params: Record<string, unknown>;
          remediation?: { type: string; params: Record<string, unknown> };
        };
      }
      const captured = unwrap<{
        candidates: Candidate[];
        problems: string[];
        games: {
          id: string;
          name: string;
          installs: { installDir: string; source: string; launch?: unknown }[];
        }[];
        suggested: { game?: string };
      }>(await ctx.invoke('profiles:capture'));
      if (!captured.ok) return captured;
      const game = input.game ?? captured.value.suggested.game;
      if (input.game && !captured.value.games.some((g) => g.id === input.game)) {
        return err(
          'mcp.game',
          `No game "${input.game}" was found on this PC.`,
          `Games found: ${captured.value.games.map((g) => g.id).join(', ') || 'none'}.`
        );
      }
      const kept = captured.value.candidates.filter(
        (c) => (input.everything || c.selectedByDefault) && (!c.game || c.game === game)
      );
      const leftOut = captured.value.candidates
        .filter((c) => !kept.includes(c))
        .map((c) => c.title);
      const install = captured.value.games.find((g) => g.id === game)?.installs[0];
      const created = unwrap<{
        id: string;
        name: string;
        game?: string;
        checks: { title: string; required: boolean; type: string }[];
      }>(
        await ctx.invoke('profiles:create', {
          name: input.name,
          ...(game ? { game } : {}),
          ...(install?.launch ? { launch: install.launch } : {}),
          checks: kept.map((c) => c.check),
        })
      );
      if (!created.ok) return created;
      return ok({
        id: created.value.id,
        name: created.value.name,
        ...(created.value.game ? { game: created.value.game } : {}),
        checks: created.value.checks.map((c) => ({
          title: c.title,
          required: c.required,
          type: c.type,
        })),
        leftOut,
        problems: captured.value.problems,
      });
    },
  });

  add({
    name: 'device_find_by_press',
    title: 'Which device is it? Press a button',
    description:
      'Waits for the user to press a button on any game controller and answers with that device: name, vendor and product id. Use it to tell identical devices apart or to learn which physical device a name belongs to, instead of guessing. Ask the user to press first.',
    input: z.object({
      timeoutSeconds: z
        .number()
        .int()
        .min(1)
        .max(60)
        .default(15)
        .describe('How long to wait for the press.'),
    }),
    output: z.object({
      pressed: z.boolean(),
      device: z
        .object({ name: z.string(), vendorId: z.string(), productId: z.string() })
        .optional(),
    }),
    tier: 'read',
    summarize: () => 'Wait for a button press',
    run: async (input, ctx) => {
      const waited = unwrap<{ device?: { name: string; vendorId: string; productId: string } }>(
        await ctx.invoke('profiles:waitForPress', { timeoutSeconds: input.timeoutSeconds })
      );
      if (!waited.ok) return waited;
      return ok(
        waited.value.device ? { pressed: true, device: waited.value.device } : { pressed: false }
      );
    },
  });

  add({
    name: 'manual_search',
    title: 'Search the manual',
    description:
      'Finds the pages of the RigReady manual that hold every word of the query, best first, with the matching lines and the URI to read each page in full (rigready://docs/...).',
    input: z.object({ query: z.string().trim().min(2).max(200) }),
    output: z.object({
      hits: z.array(
        z.object({
          uri: z.string(),
          url: z.string(),
          title: z.string(),
          lines: z.array(z.string()),
        })
      ),
    }),
    tier: 'read',
    run: async (input) => ok({ hits: searchManual(deps.manual(), input.query) }),
  });

  add({
    name: 'manual_read',
    title: 'Read a manual page',
    description:
      'Reads one page of the RigReady manual in full, as Markdown: give its path ("setups/scripts"), its rigready://docs URI or its https://rigready.io/docs/ address, as manual_search returned it. The same text as the rigready://docs resources. Link the page (url) when you answer from it.',
    input: z.object({
      page: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .describe('"setups/scripts", "rigready://docs/setups/scripts" or its rigready.io address.'),
    }),
    output: z.object({ title: z.string(), url: z.string(), uri: z.string(), text: z.string() }),
    tier: 'read',
    summarize: (input) => `Read the manual page ${input.page}`,
    run: async (input) => {
      const read = readManualPage(deps.manual(), input.page);
      if (!read.ok) return err('mcp.manual', read.message);
      return ok({
        title: read.page.title,
        url: webUrl(read.page.path),
        uri: read.page.uri,
        text: read.text,
      });
    },
  });

  return tools;
}
