import type { z } from 'zod';
import type { ChannelTier, Envelope } from '../shared/ipc';
import type { Result } from './result';

/**
 * What a feature offers an AI assistant through the MCP server, beyond its IPC channels
 * (every channel of every contract is offered by itself, from the contract's own `describe`
 * and `tier`). A feature registers task-level tools, resources and prompts of its own from
 * its `main.ts`; the `mcp` feature serves them. Nothing here touches the machine: a tool
 * works through `ctx.invoke`, the same validated channels a window of the app calls.
 *
 *   ctx.mcp.registerTool({
 *     name: 'rig_check', title: 'Check the rig', tier: 'read',
 *     description: 'Runs the checklist of a setup and says what is not met.',
 *     input: z.object({ setup: z.string().optional() }),
 *     async run({ setup }, ctx) { return ctx.invoke('fly:check', { profileId: ... }); },
 *   });
 */

/** What a tool, a resource or a prompt is given when it runs. */
export interface McpCallContext {
  /** The paired assistant the call comes from, as the user named it ("Claude Code"). */
  client: string;
  /** Calls an IPC channel of the app, validated, as a window of the app would. */
  invoke(channel: string, input?: unknown): Promise<Envelope>;
  /** Aborted when the assistant gave up on the call. */
  signal: AbortSignal;
}

/** The tiers a tool may have; `off` is for a channel, never for a tool somebody wrote. */
export type McpToolTier = Exclude<ChannelTier, 'off'>;

export interface McpToolDefinition<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
> {
  /** Lower-case words joined by underscores ("rig_make_ready"), unique across the app. Never starts with "ipc_", the prefix of the channel tools. */
  name: string;
  /** What it is called in a list ("Make the rig ready"). */
  title: string;
  /** What it does, what it needs and when to use it, in a few sentences. The assistant reads this. */
  description: string;
  /** A zod object schema: the tool's arguments. */
  input: I;
  /** The shape of what `run` answers, when it is worth declaring. */
  output?: O;
  tier: McpToolTier;
  /** One line for the confirm dialog, from the arguments: "Make DCS F/A-18C ready". Default: the title. */
  summarize?: (input: z.output<I>) => string;
  /** The work. An error result is reported to the assistant as the tool's failure, in words. */
  run(input: z.output<I>, ctx: McpCallContext): Promise<Result<z.input<O>>>;
}

/** A fixed resource: one URI, read on demand. */
export interface McpResourceDefinition {
  /** "rigready://rig/state" */
  uri: string;
  /** A short name ("rig-state"). */
  name: string;
  title: string;
  description: string;
  /** "text/markdown", "application/json", "application/yaml". */
  mimeType: string;
  read(ctx: McpCallContext): Promise<Result<string>>;
}

/** A family of resources under one URI template ("rigready://setups/{id}"). */
export interface McpResourceTemplateDefinition {
  /** RFC 6570 template: "rigready://setups/{id}". */
  uriTemplate: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  /** The resources that exist right now, for the client's list. */
  list(
    ctx: McpCallContext
  ): Promise<Result<{ uri: string; title: string; description?: string }[]>>;
  /** Reads one, from the variables the template matched. */
  read(variables: Record<string, string>, ctx: McpCallContext): Promise<Result<string>>;
}

export interface McpPromptMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface McpPromptDefinition {
  /** Lower-case words joined by underscores ("first_setup"). */
  name: string;
  title: string;
  description: string;
  arguments?: { name: string; description: string; required?: boolean }[];
  /** The conversation to start, from the arguments the user gave. */
  get(
    args: Record<string, string>,
    ctx: McpCallContext
  ): Promise<Result<{ description?: string; messages: McpPromptMessage[] }>>;
}

/**
 * One tool as an assistant inside the app is offered it: the same catalogue entry the MCP
 * server lists, without the parts only the protocol needs.
 */
export interface HostedTool {
  name: string;
  title: string;
  description: string;
  tier: ChannelTier;
  /** JSON Schema of the arguments. */
  inputSchema: Record<string, unknown>;
}

/** Who a hosted call is made for: an id for the rate limit, a name for the record and the Safety page. */
export interface HostCaller {
  id: string;
  name: string;
  signal: AbortSignal;
}

/**
 * The tool catalogue and the gate as one object, for an assistant that is not reached over
 * MCP (the built-in one). The mcp feature provides it; every call takes the same path an
 * MCP tool call does: rate limit, tier against the confirm policy, the question in the
 * window, one change at a time, the activity record under the caller's name, and the
 * caller's name beside the Safety page actions it left.
 */
export interface ToolHost {
  /** The guided surface: task-level tools, rigready_channels and rigready_call. */
  tools(): HostedTool[];
  call(caller: HostCaller, name: string, args: unknown): Promise<Result<unknown>>;
}

const TOOL_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

export class McpRegistry {
  private readonly toolList: McpToolDefinition[] = [];
  private readonly resourceList: McpResourceDefinition[] = [];
  private readonly templateList: McpResourceTemplateDefinition[] = [];
  private readonly promptList: McpPromptDefinition[] = [];
  private toolHost: ToolHost | undefined;

  /** The mcp feature hands over the catalogue and gate it serves, once, at setup. */
  provideHost(host: ToolHost): void {
    if (this.toolHost) throw new Error('A tool host is provided twice');
    this.toolHost = host;
  }

  /** The catalogue and gate, when the feature that serves them is wired. */
  host(): ToolHost | undefined {
    return this.toolHost;
  }

  registerTool<I extends z.ZodType, O extends z.ZodType>(tool: McpToolDefinition<I, O>): void {
    if (!TOOL_NAME.test(tool.name) || tool.name.startsWith('ipc_')) {
      throw new Error(`Not a tool name: "${tool.name}" (lower-case words joined by underscores)`);
    }
    if (this.toolList.some((t) => t.name === tool.name)) {
      throw new Error(`MCP tool registered twice: ${tool.name}`);
    }
    if (tool.description.trim().length < 20) {
      throw new Error(`MCP tool ${tool.name} needs a description an assistant can act on`);
    }
    this.toolList.push(tool as unknown as McpToolDefinition);
  }

  registerResource(resource: McpResourceDefinition): void {
    if (this.resourceList.some((r) => r.uri === resource.uri)) {
      throw new Error(`MCP resource registered twice: ${resource.uri}`);
    }
    this.resourceList.push(resource);
  }

  registerResourceTemplate(template: McpResourceTemplateDefinition): void {
    if (this.templateList.some((t) => t.uriTemplate === template.uriTemplate)) {
      throw new Error(`MCP resource template registered twice: ${template.uriTemplate}`);
    }
    this.templateList.push(template);
  }

  registerPrompt(prompt: McpPromptDefinition): void {
    if (!TOOL_NAME.test(prompt.name)) {
      throw new Error(
        `Not a prompt name: "${prompt.name}" (lower-case words joined by underscores)`
      );
    }
    if (this.promptList.some((p) => p.name === prompt.name)) {
      throw new Error(`MCP prompt registered twice: ${prompt.name}`);
    }
    this.promptList.push(prompt);
  }

  tools(): McpToolDefinition[] {
    return [...this.toolList];
  }
  resources(): McpResourceDefinition[] {
    return [...this.resourceList];
  }
  resourceTemplates(): McpResourceTemplateDefinition[] {
    return [...this.templateList];
  }
  prompts(): McpPromptDefinition[] {
    return [...this.promptList];
  }
}
