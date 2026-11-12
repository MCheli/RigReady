import type { McpCallContext } from '../../../core/mcp';
import { err, ok, type Result } from '../../../core/result';
import type { ChannelDef, ChannelTier } from '../../../shared/ipc';
import {
  BUILTIN_CALL_TOOL,
  BUILTIN_CHANNELS_TOOL,
  CallToolInput,
  ChannelsToolInput,
  channelInputOf,
  renderChannelReference,
  renderFeatureIndex,
  renderFeatureSummary,
  type Catalogue,
  type ToolSpec,
} from './catalogue';
import type { ToolCall } from './gate';
import { channelInputFrom } from './jsonSchema';

/**
 * What a call of one catalogue tool with these arguments means for the gate: the tier,
 * the one-line summary and the work. Shared by the MCP server and the built-in assistant,
 * so the same arguments are taken the same way whichever door they came in by. Arguments
 * that do not fit are refused here, before the gate (and before anything is asked).
 */

export interface DispatchDeps {
  catalogue: Catalogue;
  /** The channel's zod input, to shape a tool's arguments the way the channel takes them. */
  channelDef(channel: string): ChannelDef | undefined;
}

/**
 * What a channel does, as the line of a question: the first sentence its contract describes
 * it with, without the full stop. Undefined for a channel with no description.
 */
export function plainLine(describe: string | undefined): string | undefined {
  const first = describe
    ?.trim()
    .split(/(?<=[.!?])\s/)[0]
    ?.replace(/[.\s]+$/, '');
  return first ? first : undefined;
}

function channelCall(
  deps: DispatchDeps,
  channel: string,
  tier: ChannelTier,
  tool: string,
  args: unknown
): ToolCall {
  const def = deps.channelDef(channel);
  const input = def ? channelInputFrom(def.input, args) : args;
  // The call as it was made. It used to be the whole question ('safety:undo {"groupId":...}').
  const made = `${channel}${input === undefined ? '' : ` ${JSON.stringify(input).slice(0, 120)}`}`;
  const plain = plainLine(def?.meta?.describe);
  return {
    tool,
    tier,
    channel,
    // In words where the channel has them, with the call itself kept in sight under them.
    summary: plain ?? made,
    ...(plain ? { detail: made } : {}),
    work: async (c) => c.invoke(channel, input),
  };
}

export function planToolCall(spec: ToolSpec, args: unknown, deps: DispatchDeps): Result<ToolCall> {
  const { catalogue } = deps;
  if (spec.kind === 'channel' && spec.channel) {
    return ok(channelCall(deps, spec.channel, spec.tier, spec.name, args));
  }
  if (spec.kind === 'curated' && spec.curated) {
    const curated = spec.curated;
    const parsed = curated.input.safeParse(args ?? {});
    if (!parsed.success) {
      return err('mcp.input', `Invalid arguments for ${spec.name}.`, parsed.error.message);
    }
    const summarize = curated.summarize;
    return ok({
      tool: spec.name,
      tier: spec.tier,
      // The title, until the gate has the tool's own line worked out (it may look a name up).
      summary: curated.title,
      ...(summarize ? { describe: async (c: McpCallContext) => summarize(parsed.data, c) } : {}),
      work: async (c) => {
        const result = await curated.run(parsed.data, c);
        if (!result.ok || !curated.output) return result;
        // Answered in the shape the tool declares: fields it does not name are left out.
        const shaped = curated.output.safeParse(result.value);
        return shaped.success
          ? ok(shaped.data)
          : err(
              'mcp.output',
              `${spec.name} answered in a shape it does not declare.`,
              shaped.error.message
            );
      },
    });
  }
  if (spec.name === BUILTIN_CHANNELS_TOOL) {
    const parsed = ChannelsToolInput.safeParse(args ?? {});
    const channel = parsed.success ? parsed.data.channel?.trim() || undefined : undefined;
    const feature = parsed.success ? parsed.data.feature?.trim() || undefined : undefined;
    const known = (id: string): boolean => catalogue.reference.some((r) => r.feature === id);
    return ok({
      tool: spec.name,
      tier: 'read',
      summary: channel
        ? `What ${channel} takes and answers`
        : feature
          ? `The channels of ${feature}`
          : 'The features',
      // Shortest first: the features, one feature's channels in a line each, then one
      // channel in full. An assistant pays for every character again with each request.
      work: async () => {
        if (channel) {
          const row = channelInputOf(catalogue.reference, channel);
          if (row) return ok(renderChannelReference(row));
          const of = channel.includes(':') ? channel.slice(0, channel.indexOf(':')) : channel;
          return err(
            'mcp.channel',
            `There is no channel "${channel}".`,
            known(of)
              ? renderFeatureSummary(catalogue.reference, of)
              : renderFeatureIndex(catalogue.reference)
          );
        }
        if (!feature) return ok(renderFeatureIndex(catalogue.reference));
        if (!known(feature)) {
          return err(
            'mcp.feature',
            `There is no feature "${feature}".`,
            renderFeatureIndex(catalogue.reference)
          );
        }
        return ok(renderFeatureSummary(catalogue.reference, feature));
      },
    });
  }
  if (spec.name === BUILTIN_CALL_TOOL) {
    const parsed = CallToolInput.safeParse(args);
    if (!parsed.success) {
      return err('mcp.input', 'rigready_call needs a channel name.', parsed.error.message);
    }
    const reference = channelInputOf(catalogue.reference, parsed.data.channel);
    if (!reference) {
      return err(
        'mcp.channel',
        `There is no channel "${parsed.data.channel}".`,
        'Ask rigready_channels for the features, then for the channels of one (or read rigready://ipc and rigready://ipc/<feature>).'
      );
    }
    return ok(
      channelCall(deps, reference.channel, reference.tier, spec.name, parsed.data.input ?? {})
    );
  }
  return err('mcp.tool', `${spec.name} is not served.`);
}
