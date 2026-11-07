import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { McpRegistry } from '../../../core/mcp';
import { ok } from '../../../core/result';
import { channel, defineContract, noInput, type Contract } from '../../../shared/ipc';
import { discoverContracts } from '../../../../tests/schemaWalk';
import {
  BUILTIN_CALL_TOOL,
  BUILTIN_CHANNELS_TOOL,
  buildCatalogue,
  catalogueProblems,
  deriveChannels,
  renderCatalogue,
  renderFeatureIndex,
  renderFeatureReference,
} from './catalogue';
import { channelInputFrom, inputJsonSchema, takesNoInput } from './jsonSchema';
import { channelOfToolName, channelToolName } from './names';
import { annotationsFor, gateDecision, tierOf } from './tiers';

/** Every feature contract, the way the app finds them, minus the shell's own. */
const contracts = (): Contract[] => discoverContracts().filter((c) => c.feature !== 'app');

const example = defineContract('zz-example', {
  /** A read. */
  ping: channel(z.object({ text: z.string() }), z.object({ echo: z.string() }), {
    describe: 'Answers with the text it was given.',
    tier: 'read',
  }),
  count: channel(noInput, z.object({ pings: z.number() })),
  secret: channel(noInput, z.object({ token: z.string() }), {
    describe: 'Hands out a secret.',
    tier: 'off',
  }),
  launch: channel(z.object({ id: z.string() }), z.object({ started: z.boolean() }), {
    describe: 'Starts the game.',
    tier: 'launch',
  }),
});

describe('MCP-001 every channel of every contract becomes one tool, from the contract alone', () => {
  it('derives a tool per channel, named from the channel, with its schema, description and tier', () => {
    const derived = deriveChannels([example]);
    expect(derived.tools.map((t) => t.name)).toEqual([
      'ipc_zz-example_ping',
      'ipc_zz-example_count',
      'ipc_zz-example_launch',
    ]);
    const ping = derived.tools[0]!;
    expect(ping.channel).toBe('zz-example:ping');
    expect(ping.tier).toBe('read');
    expect(ping.description).toContain('Answers with the text it was given.');
    expect(ping.inputSchema).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    });
    expect(ping.annotations).toEqual(annotationsFor('read'));
    // A channel without metadata: the safe tier, a description from its name.
    const count = derived.tools[1]!;
    expect(count.tier).toBe('change');
    expect(count.description).toContain('count channel of the zz-example feature');
    expect(count.inputSchema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
    expect(derived.undescribed).toEqual(['zz-example:count']);
    expect(derived.untiered).toEqual(['zz-example:count']);
    // A channel that is off is in the reference but never a tool.
    expect(derived.reference.map((r) => r.channel)).toContain('zz-example:secret');
    expect(derived.tools.some((t) => t.channel === 'zz-example:secret')).toBe(false);
  });

  it('names read back to their channel, and nothing else does', () => {
    expect(channelToolName('dcs-bindings', 'plan')).toBe('ipc_dcs-bindings_plan');
    expect(channelOfToolName('ipc_dcs-bindings_plan')).toEqual({
      feature: 'dcs-bindings',
      key: 'plan',
    });
    expect(channelOfToolName('ipc_fly_makeReady')).toEqual({ feature: 'fly', key: 'makeReady' });
    for (const name of ['rig_check', 'ipc_', 'ipc_fly', 'ipc_fly_', 'ipc_Fly_check', 'fly:check']) {
      expect(channelOfToolName(name), name).toBeUndefined();
    }
  });

  it('every channel of every real contract appears exactly once, with a sound schema and words', () => {
    const all = contracts();
    const derived = deriveChannels(all);
    const channels = all.flatMap((c) =>
      Object.keys(c.channels).map((key) => `${c.feature}:${key}`)
    );
    expect(channels.length).toBeGreaterThan(200);
    expect(derived.reference.map((r) => r.channel)).toEqual(channels);
    const names = derived.tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(derived.problems).toEqual([]);
    for (const tool of derived.tools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(20);
      expect(tool.inputSchema['type'], tool.name).toBe('object');
      expect(['read', 'change', 'launch']).toContain(tool.tier);
    }
    const full = buildCatalogue({ contracts: all, registry: new McpRegistry(), surface: 'full' });
    expect(catalogueProblems(full)).toEqual([]);
    expect(full.tools.filter((t) => t.kind === 'channel').length).toBe(derived.tools.length);
    expect(full.tools.map((t) => t.name)).toContain(BUILTIN_CALL_TOOL);
    expect(full.tools.map((t) => t.name)).toContain(BUILTIN_CHANNELS_TOOL);
    const guided = buildCatalogue({
      contracts: all,
      registry: new McpRegistry(),
      surface: 'guided',
    });
    expect(guided.tools.map((t) => t.kind)).toEqual(['builtin', 'builtin']);
    expect(guided.reference.length).toBe(channels.length);
  });

  it('a channel that would hand an assistant a secret is off', () => {
    const derived = deriveChannels(contracts());
    const off = derived.reference.filter((r) => r.tier === 'off').map((r) => r.channel);
    for (const channel of [
      'settings:setAiKey',
      'settings:clearAiKey',
      'mcp:pair',
      'mcp:answer',
      'mcp:clientConfig',
    ]) {
      expect(off, channel).toContain(channel);
    }
  });

  /**
   * Channels whose contract says nothing yet (no `describe`, or no `tier`): each is a task
   * for the feature that owns it (docs/research/mcp-server.md). The list only shrinks: a
   * new channel is described when it is written, and a described one leaves the list.
   */
  it('the channels still without metadata are exactly the known ones', () => {
    const derived = deriveChannels(contracts());
    const missing = [...new Set([...derived.undescribed, ...derived.untiered])].sort();
    expect(missing).toEqual(STILL_WITHOUT_METADATA);
  });

  it('a task-level tool a feature registers is offered on both surfaces, before the built-ins', () => {
    const registry = new McpRegistry();
    registry.registerTool({
      name: 'rig_check',
      title: 'Check the rig',
      description: 'Runs the checklist of a setup and says what is not met.',
      input: z.object({ setup: z.string().optional() }),
      output: z.object({ ready: z.boolean() }),
      tier: 'read',
      run: async () => ok({ ready: true }),
    });
    const guided = buildCatalogue({ contracts: [example], registry, surface: 'guided' });
    expect(guided.tools.map((t) => [t.name, t.kind])).toEqual([
      ['rig_check', 'curated'],
      [BUILTIN_CHANNELS_TOOL, 'builtin'],
      [BUILTIN_CALL_TOOL, 'builtin'],
    ]);
    expect(guided.tools[0]!.outputSchema).toMatchObject({ type: 'object' });
    expect(catalogueProblems(guided)).toEqual([]);
    // A name that could be mistaken for a channel tool, or that is used twice, is refused.
    expect(() =>
      registry.registerTool({
        name: 'ipc_fly_check',
        title: 'x',
        description: 'A tool that pretends to be a channel tool.',
        input: z.object({}),
        tier: 'read',
        run: async () => ok(null),
      })
    ).toThrow(/Not a tool name/);
    expect(() =>
      registry.registerTool({
        name: 'rig_check',
        title: 'x',
        description: 'The same name a second time, which is refused.',
        input: z.object({}),
        tier: 'read',
        run: async () => ok(null),
      })
    ).toThrow(/registered twice/);
  });

  it('renders the reference and the catalogue as text an assistant and a reader can use', () => {
    const catalogue = buildCatalogue({
      contracts: [example],
      registry: new McpRegistry(),
      surface: 'full',
    });
    const reference = renderFeatureReference(catalogue.reference, 'zz-example');
    expect(reference).toContain('## zz-example:ping');
    expect(reference).toContain('`ipc_zz-example_secret` (not offered)');
    expect(reference).toContain('"required":["text"]');
    expect(renderFeatureIndex(catalogue.reference)).toContain(
      '**zz-example**: 3 channels offered (1 not offered)'
    );
    const markdown = renderCatalogue(catalogue);
    expect(markdown).toContain('| `ipc_zz-example_ping` | channel | read |');
    expect(markdown).toContain('- `zz-example:secret`: Hands out a secret.');
    expect(markdown).toContain('Without `describe`: 1.');
  });
});

describe('MCP-001 the shapes of inputs', () => {
  it('tells a channel that takes nothing from one that takes an object with only optional fields', () => {
    expect(takesNoInput(noInput)).toBe(true);
    expect(takesNoInput(z.object({ limit: z.number().optional() }).optional())).toBe(false);
    expect(takesNoInput(z.object({ id: z.string() }))).toBe(false);
    expect(channelInputFrom(noInput, {})).toBeUndefined();
    expect(channelInputFrom(z.object({ id: z.string() }), { id: 'a' })).toEqual({ id: 'a' });
    // An input that is not an object is wrapped as { value } for the assistant and unwrapped for the channel.
    const list = z.array(z.string());
    expect(inputJsonSchema(list).schema).toMatchObject({
      type: 'object',
      properties: { value: { type: 'array' } },
      required: ['value'],
    });
    expect(channelInputFrom(list, { value: ['a'] })).toEqual(['a']);
  });

  it('the gate runs reads, asks for changes under the default policy, and refuses what is off', () => {
    expect(gateDecision('read', 'ask')).toBe('run');
    expect(gateDecision('change', 'ask')).toBe('confirm');
    expect(gateDecision('change', 'launchOnly')).toBe('run');
    expect(gateDecision('change', 'never')).toBe('run');
    expect(gateDecision('launch', 'ask')).toBe('confirm');
    expect(gateDecision('launch', 'launchOnly')).toBe('confirm');
    expect(gateDecision('launch', 'never')).toBe('run');
    expect(gateDecision('off', 'never')).toBe('refuse');
    expect(tierOf(channel(noInput, z.null()))).toBe('change');
  });
});

/** Kept by hand, and only ever shortened. Sorted. */
const STILL_WITHOUT_METADATA: string[] = [];
