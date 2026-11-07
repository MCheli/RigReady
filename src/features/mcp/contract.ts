import { z } from 'zod';
import { channel, defineContract, noInput } from '../../shared/ipc';
import { ActivityEntrySchema } from './core/activity';
import { ConfirmRequestSchema } from './core/confirm';
import { ConfirmPolicySchema, PairingSchema, SurfaceSchema } from './core/store';

/** A pairing as the Settings page lists it: never its token. */
export const PairingViewSchema = PairingSchema.omit({ tokenHash: true });
export type PairingView = z.infer<typeof PairingViewSchema>;

export const ToolLineSchema = z.object({
  name: z.string(),
  title: z.string(),
  tier: z.enum(['read', 'change', 'launch', 'off']),
  kind: z.enum(['channel', 'curated', 'builtin']),
});

export const McpStatusSchema = z.object({
  enabled: z.boolean(),
  /** Listening right now. */
  running: z.boolean(),
  /** The port the settings name; 0 means any free port. */
  port: z.number().int(),
  /** Where it listens, while it does. */
  endpoint: z.object({ url: z.string(), port: z.number().int() }).optional(),
  /** Why it is enabled but not running. */
  problem: z.string().optional(),
  confirm: ConfirmPolicySchema,
  surface: SurfaceSchema,
  pairings: z.array(PairingViewSchema),
  /** Requests that carried a known token, in this run. */
  requests: z.number().int(),
  lastRequestAt: z.string().optional(),
  /** How this copy of RigReady is started, for the client configurations. */
  self: z.object({ exe: z.string(), args: z.array(z.string()) }),
  catalogue: z.object({
    tools: z.number().int(),
    curated: z.number().int(),
    channels: z.number().int(),
    offChannels: z.number().int(),
    resources: z.number().int(),
    prompts: z.number().int(),
    /** Channels whose contract has no description or tier yet. */
    undescribed: z.number().int(),
  }),
  /** Tool calls recorded in this run. */
  activity: z.number().int(),
  /** Questions waiting for the user. */
  pending: z.array(ConfirmRequestSchema),
});
export type McpStatus = z.infer<typeof McpStatusSchema>;

export const ClientKindSchema = z.enum([
  'claude-desktop',
  'claude-code',
  'claude-code-http',
  'cursor',
  'cursor-http',
  'vscode',
  'http',
]);

export const mcpContract = defineContract(
  'mcp',
  {
    status: channel(noInput, McpStatusSchema, {
      describe:
        'The state of the MCP server itself: whether it listens and where, the confirm policy, the surface, the paired assistants (never their tokens) and counts of what it offers.',
      tier: 'read',
    }),
    /** Turns the server on: the bridge gets a pairing, the listener starts, the endpoint file is written. */
    enable: channel(noInput, McpStatusSchema, {
      describe: 'Turns the MCP server on. Only the Settings page does this.',
      tier: 'off',
    }),
    disable: channel(noInput, McpStatusSchema, {
      describe: 'Turns the MCP server off. Only the Settings page does this.',
      tier: 'off',
    }),
    /** The confirm policy, the surface or the port; a port change restarts the listener. */
    setOptions: channel(
      z.object({
        confirm: ConfirmPolicySchema.optional(),
        surface: SurfaceSchema.optional(),
        port: z.number().int().min(0).max(65535).optional(),
      }),
      McpStatusSchema,
      { describe: 'Changes the confirm policy, the surface or the port.', tier: 'off' }
    ),
    /** Pairs an HTTP client under a name. The token is in the answer once and nowhere else. */
    pair: channel(
      z.object({ name: z.string().trim().min(1).max(60) }),
      z.object({ pairing: PairingViewSchema, token: z.string(), status: McpStatusSchema }),
      {
        describe: 'Pairs an assistant and hands out its token. Only the Settings page does this.',
        tier: 'off',
      }
    ),
    revoke: channel(z.object({ id: z.string().max(80) }), McpStatusSchema, {
      describe: 'Forgets a pairing; its token stops working at once.',
      tier: 'off',
    }),
    /** A new token for the bridge; the old one stops working. */
    rotateBridgeToken: channel(noInput, McpStatusSchema, {
      describe: 'Gives the stdio bridge a new token.',
      tier: 'off',
    }),
    /** What to paste into a client. With a token, the HTTP forms carry it. */
    clientConfig: channel(
      z.object({ kind: ClientKindSchema, token: z.string().max(120).optional() }),
      z.object({ text: z.string(), hint: z.string() }),
      { describe: 'The configuration text for one client.', tier: 'off' }
    ),
    /** The same text, put on the clipboard (the token never leaves main for this). */
    copyClientConfig: channel(
      z.object({ kind: ClientKindSchema, token: z.string().max(120).optional() }),
      z.object({ copied: z.boolean() }),
      { describe: 'Copies the configuration text for one client.', tier: 'off' }
    ),
    /** What assistants did in this run, newest first. */
    activity: channel(
      z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional(),
      z.object({ entries: z.array(ActivityEntrySchema) }),
      { describe: 'What assistants did in this run of RigReady, newest first.', tier: 'read' }
    ),
    /** Every tool the server offers on the current surface, one line each. */
    catalogue: channel(noInput, z.object({ tools: z.array(ToolLineSchema) }), {
      describe: 'Every tool the MCP server offers right now, one line each.',
      tier: 'read',
    }),
    /** The window's answer to a question an assistant's call raised. */
    answer: channel(
      z.object({ id: z.string().max(40), allow: z.boolean() }),
      z.object({ answered: z.boolean() }),
      {
        describe: 'The user answers a confirmation. Only a window of the app does this.',
        tier: 'off',
      }
    ),
  },
  {
    /** An assistant's call waits for the user: the window shows the question. */
    confirm: ConfirmRequestSchema,
    /** A question was answered, timed out or withdrawn. */
    confirmSettled: z.object({ id: z.string(), outcome: z.enum(['allowed', 'denied', 'timeout']) }),
    /** A tool call ended; the windows show a line about it. */
    activity: ActivityEntrySchema,
    /** The server's state changed (enabled, disabled, paired, a request came in). */
    changed: z.object({}),
  }
);
