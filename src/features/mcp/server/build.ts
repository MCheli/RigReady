import {
  McpServer,
  ResourceTemplate,
  fromJsonSchema,
  type CallToolResult,
  type McpRequestContext,
  type ServerContext,
} from '@modelcontextprotocol/server';
import type {
  McpPromptDefinition,
  McpResourceDefinition,
  McpResourceTemplateDefinition,
} from '../../../core/mcp';
import { err, type RigError } from '../../../core/result';
import type { Logger } from '../../../core/logger';
import type { ChannelTier } from '../../../shared/ipc';
import {
  BUILTIN_CALL_TOOL,
  BUILTIN_CHANNELS_TOOL,
  CallToolInput,
  ChannelsToolInput,
  channelInputOf,
  renderFeatureIndex,
  renderFeatureReference,
  type Catalogue,
  type ToolSpec,
} from '../core/catalogue';
import type { Caller, Gate, ToolCall } from '../core/gate';
import { channelInputFrom } from '../core/jsonSchema';
import type { ChannelDef } from '../../../shared/ipc';

/**
 * One MCP server instance from the catalogue: the SDK asks for a fresh one per HTTP request
 * (or per stdio connection), so this is cheap and holds nothing. Every tool call, resource
 * read and prompt goes through the gate with the pairing the bearer token named.
 */

export interface BuildDeps {
  version: string;
  instructions: string;
  catalogue(): Catalogue;
  /** The channel's zod input, to shape a tool's arguments the way the channel takes them. */
  channelDef(channel: string): ChannelDef | undefined;
  resources: McpResourceDefinition[];
  templates: McpResourceTemplateDefinition[];
  prompts: McpPromptDefinition[];
  gate: Gate;
  log: Logger;
}

/** Longer answers are cut; the structured part is dropped with a note. */
export const MAX_RESULT_CHARS = 1_000_000;

interface CallerInfo {
  pairingId: string;
  name: string;
}

/** Who the request is from, as the bearer check recorded it on the request. */
function callerOf(ctx: ServerContext): CallerInfo | undefined {
  const auth = ctx.http?.authInfo;
  if (!auth) return undefined;
  const extra = (auth.extra ?? {}) as { name?: unknown };
  return {
    pairingId: auth.clientId,
    name: typeof extra.name === 'string' ? extra.name : auth.clientId,
  };
}

const errorResult = (error: RigError): CallToolResult => ({
  content: [
    {
      type: 'text',
      text: `${error.code}: ${error.message}${error.detail ? ` ${error.detail}` : ''}`,
    },
  ],
  isError: true,
});

function okResult(value: unknown): CallToolResult {
  const structured =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { value: value ?? null };
  let text = JSON.stringify(structured);
  if (text.length > MAX_RESULT_CHARS) {
    text = `${text.slice(0, MAX_RESULT_CHARS)}\n[cut: the answer was ${text.length} characters]`;
    return { content: [{ type: 'text', text }] };
  }
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

export function createServerFactory(deps: BuildDeps): (ctx: McpRequestContext) => McpServer {
  return () => {
    const server = new McpServer(
      { name: 'rigready', version: deps.version },
      {
        capabilities: { tools: {}, resources: {}, prompts: {} },
        instructions: deps.instructions,
      }
    );
    const catalogue = deps.catalogue();

    const run = async (
      ctx: ServerContext,
      call: Omit<ToolCall, 'work'> & { work: ToolCall['work'] }
    ): Promise<CallToolResult> => {
      const info = callerOf(ctx);
      if (!info)
        return errorResult({ code: 'mcp.unpaired', message: 'This request carries no pairing.' });
      const caller: Caller = {
        pairingId: info.pairingId,
        client: info.name,
        signal: ctx.mcpReq.signal,
      };
      const outcome = await deps.gate.call(caller, call);
      return outcome.ok ? okResult(outcome.value) : errorResult(outcome.error);
    };

    const channelCall = (
      channel: string,
      tier: ChannelTier,
      tool: string,
      args: unknown
    ): ToolCall => {
      const def = deps.channelDef(channel);
      const input = def ? channelInputFrom(def.input, args) : args;
      return {
        tool,
        tier,
        channel,
        summary: `${channel}${input === undefined ? '' : ` ${JSON.stringify(input).slice(0, 120)}`}`,
        work: async (c) => c.invoke(channel, input),
      };
    };

    for (const spec of catalogue.tools) {
      server.registerTool(
        spec.name,
        {
          title: spec.title,
          description: spec.description,
          inputSchema: fromJsonSchema(spec.inputSchema as never),
          ...(spec.outputSchema
            ? { outputSchema: fromJsonSchema(spec.outputSchema as never) }
            : {}),
          annotations: { title: spec.title, ...spec.annotations },
          _meta: {
            'io.rigready/kind': spec.kind,
            'io.rigready/tier': spec.tier,
            ...(spec.channel ? { 'io.rigready/channel': spec.channel } : {}),
          },
        },
        async (args: unknown, ctx: ServerContext) => {
          if (spec.kind === 'channel' && spec.channel) {
            return run(ctx, channelCall(spec.channel, spec.tier, spec.name, args));
          }
          if (spec.kind === 'curated' && spec.curated) {
            const curated = spec.curated;
            const parsed = curated.input.safeParse(args);
            if (!parsed.success) {
              return errorResult({
                code: 'mcp.input',
                message: `Invalid arguments for ${spec.name}.`,
                detail: parsed.error.message,
              });
            }
            const summary = curated.summarize ? curated.summarize(parsed.data) : curated.title;
            return run(ctx, {
              tool: spec.name,
              tier: spec.tier,
              summary,
              work: async (c) => {
                const result = await curated.run(parsed.data, c);
                if (!result.ok || !curated.output) return result;
                // Answered in the shape the tool declares: fields it does not name are left out.
                const shaped = curated.output.safeParse(result.value);
                return shaped.success
                  ? { ok: true, value: shaped.data }
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
            const feature = parsed.success ? parsed.data.feature : undefined;
            return run(ctx, {
              tool: spec.name,
              tier: 'read',
              summary: feature ? `The channels of ${feature}` : 'The features',
              work: async () => {
                if (!feature) return { ok: true, value: renderFeatureIndex(catalogue.reference) };
                if (!catalogue.reference.some((r) => r.feature === feature)) {
                  return err(
                    'mcp.feature',
                    `There is no feature "${feature}".`,
                    renderFeatureIndex(catalogue.reference)
                  );
                }
                return { ok: true, value: renderFeatureReference(catalogue.reference, feature) };
              },
            });
          }
          if (spec.name === BUILTIN_CALL_TOOL) {
            const parsed = CallToolInput.safeParse(args);
            if (!parsed.success) {
              return errorResult({
                code: 'mcp.input',
                message: 'rigready_call needs a channel name.',
                detail: parsed.error.message,
              });
            }
            const reference = channelInputOf(catalogue.reference, parsed.data.channel);
            if (!reference) {
              return errorResult({
                code: 'mcp.channel',
                message: `There is no channel "${parsed.data.channel}".`,
                detail:
                  'Read rigready://ipc for the features and rigready://ipc/<feature> for their channels.',
              });
            }
            return run(
              ctx,
              channelCall(reference.channel, reference.tier, spec.name, parsed.data.input ?? {})
            );
          }
          return errorResult({ code: 'mcp.tool', message: `${spec.name} is not served.` });
        }
      );
    }

    const readThroughGate = async (
      ctx: ServerContext,
      uri: string,
      mimeType: string,
      read: ToolCall['work']
    ) => {
      const result = await run(ctx, {
        tool: `read ${uri}`,
        tier: 'read',
        summary: `Read ${uri}`,
        work: read,
      });
      if (result.isError) {
        const text = result.content[0];
        throw new Error(text && text.type === 'text' ? text.text : `Could not read ${uri}.`);
      }
      const value = result.structuredContent as { value?: unknown } | undefined;
      const text =
        typeof value?.['value'] === 'string'
          ? value['value']
          : ((result.content[0] as { text?: string })?.text ?? '');
      return { contents: [{ uri, mimeType, text }] };
    };

    for (const resource of deps.resources) {
      server.registerResource(
        resource.name,
        resource.uri,
        { title: resource.title, description: resource.description, mimeType: resource.mimeType },
        (uri, ctx) => readThroughGate(ctx, uri.href, resource.mimeType, (c) => resource.read(c))
      );
    }
    for (const template of deps.templates) {
      server.registerResource(
        template.name,
        new ResourceTemplate(template.uriTemplate, {
          list: async (ctx) => {
            const info = callerOf(ctx);
            const listed = await template.list({
              client: info?.name ?? 'unknown',
              invoke: (channel, input) => deps.gate.invoke(channel, input),
              signal: ctx.mcpReq.signal,
            });
            if (!listed.ok) return { resources: [] };
            return {
              resources: listed.value.map((r) => ({
                uri: r.uri,
                name: r.title,
                title: r.title,
                mimeType: template.mimeType,
                ...(r.description ? { description: r.description } : {}),
              })),
            };
          },
        }),
        { title: template.title, description: template.description, mimeType: template.mimeType },
        (uri, variables, ctx) =>
          readThroughGate(ctx, uri.href, template.mimeType, (c) =>
            template.read(
              Object.fromEntries(
                Object.entries(variables).map(([k, v]) => [k, Array.isArray(v) ? (v[0] ?? '') : v])
              ),
              c
            )
          )
      );
    }

    for (const prompt of deps.prompts) {
      server.registerPrompt(
        prompt.name,
        {
          title: prompt.title,
          description: prompt.description,
          ...(prompt.arguments && prompt.arguments.length > 0
            ? {
                argsSchema: fromJsonSchema({
                  type: 'object',
                  properties: Object.fromEntries(
                    prompt.arguments.map((a) => [
                      a.name,
                      { type: 'string', description: a.description },
                    ])
                  ),
                  required: prompt.arguments.filter((a) => a.required).map((a) => a.name),
                } as never),
              }
            : {}),
        },
        (async (args: unknown, ctx: ServerContext) => {
          const info = callerOf(ctx);
          const given = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
          const strings = Object.fromEntries(
            Object.entries(given).filter((e): e is [string, string] => typeof e[1] === 'string')
          );
          const got = await prompt.get(strings, {
            client: info?.name ?? 'unknown',
            invoke: (channel, input) => deps.gate.invoke(channel, input),
            signal: ctx.mcpReq.signal,
          });
          if (!got.ok) throw new Error(got.error.message);
          return {
            ...(got.value.description ? { description: got.value.description } : {}),
            messages: got.value.messages.map((m) => ({
              role: m.role,
              content: { type: 'text' as const, text: m.text },
            })),
          };
        }) as never
      );
    }
    return server;
  };
}

/** A tool as the design document lists it, for the Settings page. */
export function toolLine(spec: ToolSpec): Pick<ToolSpec, 'name' | 'title' | 'tier' | 'kind'> {
  return { name: spec.name, title: spec.title, tier: spec.tier, kind: spec.kind };
}
