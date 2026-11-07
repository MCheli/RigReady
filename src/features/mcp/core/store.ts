import path from 'node:path';
import { z } from 'zod';
import { JsonStore } from '../../../core/jsonStore';
import type { FileStore, KnownFolders } from '../../../core/ports';

/**
 * The MCP server's own settings and the assistants paired with it, in <data root>/mcp.json.
 * Tokens are never here: a pairing holds the hash of its token, the bridge's token lives in
 * its own file (mcp/bridge-token), and an HTTP client's token is shown once when it is made.
 */

/** A port nothing else on a desk PC is likely to hold. */
export const DEFAULT_PORT = 29170;

export const ConfirmPolicySchema = z.enum(['ask', 'launchOnly', 'never']);
export const SurfaceSchema = z.enum(['guided', 'full']);

export const PairingSchema = z.object({
  id: z.string().min(1),
  /** What the user calls it ("Claude Code"), the name a change is recorded under. */
  name: z.string().min(1).max(60),
  /** bridge: RigReady.exe --mcp, for stdio clients. http: a client that holds a token of its own. */
  kind: z.enum(['bridge', 'http']),
  /** sha256 of the token, hex. */
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string(),
  lastUsedAt: z.string().optional(),
  calls: z.number().int().min(0).default(0),
});
export type Pairing = z.infer<typeof PairingSchema>;

export const McpStoreSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** The server listens while RigReady runs. Off until the user turns it on. */
  enabled: z.boolean().default(false),
  /** 0 means any free port (tests); the port is then read from the endpoint file. */
  port: z.number().int().min(0).max(65535).default(DEFAULT_PORT),
  confirm: ConfirmPolicySchema.default('ask'),
  surface: SurfaceSchema.default('guided'),
  pairings: z.array(PairingSchema).default([]),
});
export type McpStoreData = z.infer<typeof McpStoreSchema>;

export const MCP_STORE_FILE = 'mcp.json';
export { ENDPOINT_FILE, EndpointSchema, type Endpoint } from '../../../core/mcpBridge';
import { ENDPOINT_FILE } from '../../../core/mcpBridge';

export function mcpStore(
  files: FileStore,
  folders: KnownFolders
): JsonStore<typeof McpStoreSchema> {
  return new JsonStore(files, path.join(folders.dataRoot(), MCP_STORE_FILE), McpStoreSchema);
}

export const endpointFile = (folders: KnownFolders): string =>
  path.join(folders.dataRoot(), ENDPOINT_FILE);
