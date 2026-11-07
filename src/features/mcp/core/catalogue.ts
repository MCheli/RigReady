import { z } from 'zod';
import type { McpRegistry, McpToolDefinition } from '../../../core/mcp';
import { channelName } from '../../../shared/channels';
import type { ChannelTier, Contract } from '../../../shared/ipc';
import {
  inputJsonSchema,
  isSoundSchema,
  outputJsonSchema,
  takesNoInput,
  type JsonSchema,
} from './jsonSchema';
import { CHANNEL_TOOL_PREFIX, TOOL_NAME_PATTERN, channelToolName } from './names';
import { annotationsFor, tierLabel, tierOf } from './tiers';

/**
 * The catalogue: everything the MCP server offers, as data, built from the wired contracts
 * and the tools features registered. Three kinds of tool:
 *
 * - `channel`: one per IPC channel of every feature, derived from the contract (name,
 *   schema, description and tier all from there). Offered on the full surface.
 * - `curated`: a task-level tool a feature registered on `ctx.mcp`. Always offered.
 * - `builtin`: the two the mcp feature serves itself, so the guided surface still reaches
 *   every channel: `rigready_channels` (the reference) and `rigready_call` (one call).
 *
 * The catalogue is pure, so a test can hold it against the contracts and the design
 * document can be rendered from it.
 */

export type ToolKind = 'channel' | 'curated' | 'builtin';

/** Guided: the task-level tools and the two built-ins. Full: every channel as a tool too. */
export type Surface = 'guided' | 'full';

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolSpec {
  name: string;
  title: string;
  description: string;
  tier: ChannelTier;
  kind: ToolKind;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  annotations: ToolAnnotations;
  /** For a channel tool: the channel it calls ("fly:check"). */
  channel?: string;
  /** For a curated tool: its definition, to run it. */
  curated?: McpToolDefinition;
}

/** One channel in the reference an assistant can read: what it takes, what it answers, how it is gated. */
export interface ChannelReference {
  feature: string;
  key: string;
  channel: string;
  tool: string;
  tier: ChannelTier;
  description: string;
  described: boolean;
  tiered: boolean;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
}

export interface DerivedChannels {
  tools: ToolSpec[];
  reference: ChannelReference[];
  /** Channels whose input schema could not be expressed as JSON Schema, with why. */
  problems: string[];
  /** Channels with no `describe` in their contract. */
  undescribed: string[];
  /** Channels with no `tier` in their contract (treated as `change`). */
  untiered: string[];
}

export const BUILTIN_CHANNELS_TOOL = 'rigready_channels';
export const BUILTIN_CALL_TOOL = 'rigready_call';

const fallbackDescription = (feature: string, key: string): string =>
  `The ${key} channel of the ${feature} feature. Read rigready://ipc/${feature} for its fields.`;

/** Every channel of every contract as a tool, and the reference. */
export function deriveChannels(contracts: Contract[]): DerivedChannels {
  const tools: ToolSpec[] = [];
  const reference: ChannelReference[] = [];
  const problems: string[] = [];
  const undescribed: string[] = [];
  const untiered: string[] = [];
  for (const contract of contracts) {
    for (const [key, def] of Object.entries(contract.channels)) {
      const channel = channelName(contract.feature, key);
      const tool = channelToolName(contract.feature, key);
      const tier = tierOf(def);
      const described = typeof def.meta?.describe === 'string' && def.meta.describe.trim() !== '';
      if (!described) undescribed.push(channel);
      if (def.meta?.tier === undefined) untiered.push(channel);
      const description = described
        ? def.meta!.describe!.trim()
        : fallbackDescription(contract.feature, key);
      const input = inputJsonSchema(def.input);
      if (input.problem) problems.push(`${channel}: ${input.problem}`);
      const outputSchema = outputJsonSchema(def.output);
      reference.push({
        feature: contract.feature,
        key,
        channel,
        tool,
        tier,
        description,
        described,
        tiered: def.meta?.tier !== undefined,
        inputSchema: input.schema,
        ...(outputSchema ? { outputSchema } : {}),
      });
      if (tier === 'off') continue;
      tools.push({
        name: tool,
        title: channel,
        description: `${description} (The ${channel} channel of RigReady. ${tierLabel(tier)}.)`,
        tier,
        kind: 'channel',
        inputSchema: input.schema,
        annotations: annotationsFor(tier),
        channel,
      });
    }
  }
  return { tools, reference, problems, undescribed, untiered };
}

/** The task-level tools features registered, as specs. */
export function curatedTools(registry: McpRegistry): ToolSpec[] {
  return registry.tools().map((tool) => {
    const input = inputJsonSchema(tool.input);
    const output = tool.output ? outputJsonSchema(tool.output) : undefined;
    return {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      tier: tool.tier,
      kind: 'curated',
      inputSchema: input.schema,
      ...(output ? { outputSchema: output } : {}),
      annotations: annotationsFor(tool.tier),
      curated: tool,
    };
  });
}

export const ChannelsToolInput = z.object({
  /** One feature's channels; every feature's when left out. */
  feature: z.string().max(60).optional(),
});

export const CallToolInput = z.object({
  /** The channel as RigReady names it: "fly:check". */
  channel: z.string().max(120),
  /** Its input, as the channel's reference describes it. Left out for a channel that takes nothing. */
  input: z.unknown().optional(),
});

/** The two tools the mcp feature serves itself. */
export function builtinTools(): ToolSpec[] {
  return [
    {
      name: BUILTIN_CHANNELS_TOOL,
      title: 'The channel reference',
      description:
        'Lists the IPC channels of RigReady an assistant may call with rigready_call: name, what each does, what it takes and answers (JSON Schema), and whether it only reads, changes the rig or launches a game. Give a feature id ("fly", "profiles", "dcs-bindings") for one feature, or nothing for the list of features with a line each. Read the reference before calling a channel; never guess a field.',
      tier: 'read',
      kind: 'builtin',
      inputSchema: inputJsonSchema(ChannelsToolInput).schema,
      annotations: annotationsFor('read'),
    },
    {
      name: BUILTIN_CALL_TOOL,
      title: 'Call one channel',
      description:
        'Calls one IPC channel of RigReady by name ("fly:check") with the input its reference describes, exactly as a window of the app would. The same rules apply as to the channel\'s own tool: a channel that changes the rig or launches a game goes through the user\'s confirmation in RigReady, and a channel that is not offered is refused. Prefer a task-level tool when one does what you need.',
      tier: 'change',
      kind: 'builtin',
      inputSchema: inputJsonSchema(CallToolInput).schema,
      annotations: annotationsFor('change'),
    },
  ];
}

export interface Catalogue {
  surface: Surface;
  tools: ToolSpec[];
  reference: ChannelReference[];
  derived: DerivedChannels;
}

/** Everything offered on a surface, in a stable order: curated, built-in, then channel tools by name. */
export function buildCatalogue(input: {
  contracts: Contract[];
  registry: McpRegistry;
  surface: Surface;
}): Catalogue {
  const derived = deriveChannels(input.contracts);
  const curated = curatedTools(input.registry).sort((a, b) => a.name.localeCompare(b.name));
  const tools = [...curated, ...builtinTools()];
  if (input.surface === 'full') {
    tools.push(...[...derived.tools].sort((a, b) => a.name.localeCompare(b.name)));
  }
  return { surface: input.surface, tools, reference: derived.reference, derived };
}

/** Why a catalogue is not fit to serve, or nothing. For the test and the startup check. */
export function catalogueProblems(catalogue: Catalogue): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const tool of catalogue.tools) {
    if (!TOOL_NAME_PATTERN.test(tool.name)) problems.push(`${tool.name}: not a tool name`);
    if (names.has(tool.name)) problems.push(`${tool.name}: offered twice`);
    names.add(tool.name);
    if (tool.kind !== 'channel' && tool.name.startsWith(CHANNEL_TOOL_PREFIX)) {
      problems.push(`${tool.name}: only a channel tool starts with ${CHANNEL_TOOL_PREFIX}`);
    }
    if (tool.description.trim().length < 20) problems.push(`${tool.name}: no description`);
    if (!isSoundSchema(tool.inputSchema)) problems.push(`${tool.name}: input schema is not sound`);
    if (tool.tier === 'off') problems.push(`${tool.name}: an offered tool cannot be off`);
  }
  problems.push(...catalogue.derived.problems);
  return problems;
}

/** The reference of one feature, as the assistant reads it (rigready://ipc/<feature>). */
export function renderFeatureReference(reference: ChannelReference[], feature: string): string {
  const rows = reference.filter((r) => r.feature === feature);
  const lines = [`# Channels of the ${feature} feature`, ''];
  for (const row of rows) {
    lines.push(`## ${row.channel}`, '');
    lines.push(`${row.description}`, '');
    lines.push(`- Tool: \`${row.tool}\`${row.tier === 'off' ? ' (not offered)' : ''}`);
    lines.push(`- Tier: ${tierLabel(row.tier)}`);
    lines.push(`- Input: \`${JSON.stringify(row.inputSchema)}\``);
    if (row.outputSchema) lines.push(`- Output: \`${JSON.stringify(row.outputSchema)}\``);
    lines.push('');
  }
  return lines.join('\n');
}

/** The features with a line each (rigready://ipc). */
export function renderFeatureIndex(reference: ChannelReference[]): string {
  const byFeature = new Map<string, ChannelReference[]>();
  for (const row of reference) {
    byFeature.set(row.feature, [...(byFeature.get(row.feature) ?? []), row]);
  }
  const lines = ['# The IPC channels of RigReady, by feature', ''];
  for (const [feature, rows] of [...byFeature].sort(([a], [b]) => a.localeCompare(b))) {
    const offered = rows.filter((r) => r.tier !== 'off');
    lines.push(
      `- **${feature}**: ${offered.length} channels offered (${rows.length - offered.length} not offered). ${rows
        .slice(0, 6)
        .map((r) => r.key)
        .join(', ')}${rows.length > 6 ? ', ...' : ''}. Read rigready://ipc/${feature}.`
    );
  }
  return lines.join('\n');
}

/** The whole catalogue as a Markdown table, for the design document (scripts/mcp-catalogue.ts). */
export function renderCatalogue(catalogue: Catalogue): string {
  const lines = [
    '# The MCP catalogue',
    '',
    'Generated from the contracts and the registered tools by `npm run mcp:catalogue`; do not edit by hand.',
    '',
    `Surface: ${catalogue.surface}. ${catalogue.tools.length} tools: ${catalogue.tools.filter((t) => t.kind === 'curated').length} task-level, ${catalogue.tools.filter((t) => t.kind === 'builtin').length} built in, ${catalogue.tools.filter((t) => t.kind === 'channel').length} channel tools.`,
    '',
    '| Tool | Kind | Tier | Description |',
    '|---|---|---|---|',
  ];
  const cell = (text: string): string =>
    text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  for (const tool of catalogue.tools) {
    lines.push(`| \`${tool.name}\` | ${tool.kind} | ${tool.tier} | ${cell(tool.description)} |`);
  }
  const off = catalogue.reference.filter((r) => r.tier === 'off');
  lines.push('', `## Channels not offered (${off.length})`, '');
  for (const row of off) lines.push(`- \`${row.channel}\`: ${cell(row.description)}`);
  lines.push(
    '',
    `## Channels still without metadata`,
    '',
    `Without \`describe\`: ${catalogue.derived.undescribed.length}. Without \`tier\` (treated as change): ${catalogue.derived.untiered.length}.`,
    ''
  );
  return lines.join('\n');
}

/** The channel a tool call means, for a channel tool or rigready_call. */
export function channelInputOf(
  reference: ChannelReference[],
  channel: string
): ChannelReference | undefined {
  return reference.find((r) => r.channel === channel);
}

export { takesNoInput };
