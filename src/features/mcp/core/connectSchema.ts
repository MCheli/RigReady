import { z } from 'zod';

/**
 * What crosses IPC about the assistants on this PC (core/connect.ts finds them). No Node
 * imports here: the contract, and so the window, uses these schemas.
 */

export const ConnectClientSchema = z.enum([
  'claude-desktop',
  'lm-studio',
  'anythingllm',
  'jan',
  'msty',
  'goose',
  'claude-code',
  'cursor',
  'vscode',
  'windsurf',
]);
export type ConnectClient = z.infer<typeof ConnectClientSchema>;

export type ConnectMethod = 'config' | 'link' | 'command' | 'paste';

export const ConnectStateSchema = z.enum(['connected', 'different', 'absent', 'unknown']);

export const DetectedClientSchema = z.object({
  id: ConnectClientSchema,
  title: z.string(),
  /** General assistants come first; developer tools after. */
  group: z.enum(['assistant', 'developer']),
  method: z.enum(['config', 'link', 'command', 'paste']),
  /** What was found that says it is installed. */
  found: z.string(),
  /** connected: RigReady is in its settings; different: an entry named rigready points elsewhere. */
  state: ConnectStateSchema,
  /** The file a `config` connect writes, or the file the state was read from. */
  file: z.string().optional(),
  /** Why the file cannot be changed (not valid JSON, for example). */
  problem: z.string().optional(),
  /** Claude Code: its command line program, when found. */
  cli: z.string().optional(),
  /** What to do after connecting ("Restart Claude Desktop"). */
  after: z.string(),
  /** The kind of the text to paste for this client (core/clientConfig.ts). */
  kind: z.string(),
});
export type DetectedClient = z.infer<typeof DetectedClientSchema>;
