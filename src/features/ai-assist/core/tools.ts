import { z } from 'zod';
import type { McpToolDefinition } from '../../../core/mcp';
import { ok, type Result } from '../../../core/result';
import type { Envelope } from '../../../shared/ipc';
import {
  FindProgramsInputSchema,
  FoundProgramsSchema,
  ProposeSetupInputSchema,
  DraftScriptInputSchema,
} from './assistantModel';
import { setupTools } from './setupTools';

/**
 * The task-level tools for building a ready check, registered on `ctx.mcp` so that the
 * built-in assistant and every assistant paired over MCP have them, through the same gate.
 * Each one only reads or makes a draft; what a draft becomes is the user's Save in RigReady.
 */

const unwrap = <T>(envelope: Envelope): Result<T> =>
  envelope.ok ? ok(envelope.value as T) : envelope;

const Drafted = z.object({ draftId: z.string(), message: z.string() });

export function assistantTools(): McpToolDefinition[] {
  const programs: McpToolDefinition<typeof FindProgramsInputSchema, typeof FoundProgramsSchema> = {
    name: 'programs_find',
    title: 'Find installed programs',
    description:
      'Finds where programs are installed on this PC, by name or vendor: "SimAppPro", "TrackIR", "SRS", "Stream Deck", "VoiceAttack", "Tacview", "OpenKneeboard", "Pit House", "G HUB". Looks in Program Files, Program Files (x86), the Programs folder of LocalAppData, the Steam libraries and the uninstall entries of the registry; reads folder names only. Each exe comes with its path in the form a setup stores it ({PROGRAM_FILES_X86}/TrackIR5/TrackIR5.exe); "likely" marks the ones whose own name matches. Use these paths in setup_propose; never guess one.',
    input: FindProgramsInputSchema,
    output: FoundProgramsSchema,
    tier: 'read',
    summarize: (input) => `Find ${input.names.join(', ')}`,
    run: async (input, ctx) => unwrap(await ctx.invoke('ai-assist:findPrograms', input)),
  };
  const propose: McpToolDefinition<typeof ProposeSetupInputSchema, typeof Drafted> = {
    name: 'setup_propose',
    title: 'Propose setup changes',
    description:
      'Proposes checks and launch steps for an existing setup (by id or name), or a new setup (newSetup: name and game). Each check is a check type from setup_types with its params and, usually, its fix: a program that must run is {type: "process.running", params: {name: "SimAppPro.exe"}, remediation: {type: "process.launch", params: {exe: "{LOCALAPPDATA}/Programs/SimAppPro/SimAppPro.exe"}}}. Steps go before launch, after launch or at Stand down. The proposal is shown to the user in RigReady with every item; nothing is saved until they press Save there. Answers with the draft id.',
    input: ProposeSetupInputSchema,
    output: Drafted,
    tier: 'read',
    summarize: (input) =>
      input.setup
        ? `Propose changes to ${input.setup}`
        : `Propose a new setup ${input.newSetup?.name ?? ''}`,
    run: async (input, ctx) =>
      unwrap(await ctx.invoke('ai-assist:proposeSetup', { ...input, by: ctx.client })),
  };
  const script: McpToolDefinition<typeof DraftScriptInputSchema, typeof Drafted> = {
    name: 'script_draft',
    title: 'Draft a script',
    description:
      "Drafts a PowerShell (.ps1) or batch (.cmd) script for something no check type covers, with an explanation in plain words, and optionally where it goes in a setup (a check of its own, the fix of a check, or a step before launch, after launch or at Stand down). The user reads the whole script and the explanation in RigReady and saves it there; it is kept in RigReady's data folder, runs as the user and never as administrator (a script that asks for elevation is refused), always asks before it runs, and asks again if the file changes. You cannot run it: the user does, from RigReady. A check script passes with exit code 0 and must be quick.",
    input: DraftScriptInputSchema,
    output: Drafted,
    tier: 'read',
    summarize: (input) => `Draft the script ${input.fileName}`,
    run: async (input, ctx) =>
      unwrap(await ctx.invoke('ai-assist:draftScript', { ...input, by: ctx.client })),
  };
  return [...setupTools(), programs, propose, script] as unknown as McpToolDefinition[];
}
