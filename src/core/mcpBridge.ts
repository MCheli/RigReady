import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { err, ok, type Result } from './result';

/** The one path of the MCP endpoint. */
export const MCP_PATH = '/mcp';

/** Written under the data root while the server listens: where it is and which RigReady wrote it. */
export const ENDPOINT_FILE = 'mcp/endpoint.json';

export const EndpointSchema = z.object({
  /** False once the server stopped (turned off, or RigReady quit cleanly). */
  running: z.boolean().default(true),
  port: z.number().int().min(1).max(65535),
  pid: z.number().int(),
  startedAt: z.string(),
  /** The newest protocol revision the server speaks, for a bridge that wants to know. */
  protocolVersion: z.string(),
  version: z.string(),
});
export type Endpoint = z.infer<typeof EndpointSchema>;

/**
 * The bridge's token, under the data root. A file the Windows user's profile protects, not
 * Electron's safeStorage: safeStorage's key lives in the app's Chromium profile, which a
 * second process (the bridge) must neither share nor write (docs/research/mcp-server.md).
 */
export const BRIDGE_TOKEN_FILE = 'mcp/bridge-token';

/**
 * The parts of the MCP server that the stdio bridge (`src/main/mcpBridge.ts`) shares with
 * the mcp feature, which owns everything else (`src/features/mcp`).
 *
 * `RigReady.exe --mcp`: a client that only speaks stdio (Claude Desktop, Cursor, most
 * others) starts this, and it passes every message on to the RigReady that is running,
 * over its HTTP endpoint with the bridge's own token. Nothing is served here: no tools,
 * no state. When RigReady is not running, or its MCP server is off, every request is
 * answered with an error that says so, and the bridge tries again on the next one, so
 * starting RigReady later is enough.
 */

export const NOT_RUNNING =
  "RigReady is not running, or its MCP server is off. Start RigReady and turn on the MCP server on RigReady's Settings page (AI assistants), then try again.";

export interface BridgeDeps {
  /** The side facing the client (stdio). Started by the bridge. */
  downstream: Transport;
  /** A started transport to the running RigReady, or why there is none. */
  connect(): Promise<Result<Transport>>;
  /** For stderr: the client shows it in its own log. */
  note(line: string): void;
}

const isRequest = (
  m: JSONRPCMessage
): m is JSONRPCMessage & { id: string | number; method: string } =>
  'method' in m && 'id' in m && m.id !== undefined && m.id !== null;

/** Runs until the client closes its end. */
export function runBridge(deps: BridgeDeps): Promise<void> {
  let upstream: Promise<Result<Transport>> | undefined;
  let protocolVersion: string | undefined;
  const initializeIds = new Set<string | number>();

  const drop = (): void => {
    upstream = undefined;
  };
  const answerError = async (message: JSONRPCMessage, text: string): Promise<void> => {
    if (!isRequest(message)) return;
    await deps.downstream.send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32000, message: text },
    } as JSONRPCMessage);
  };
  const open = (): Promise<Result<Transport>> => {
    upstream ??= deps.connect().then((connected) => {
      if (!connected.ok) {
        drop();
        return connected;
      }
      const transport = connected.value;
      if (protocolVersion) transport.setProtocolVersion?.(protocolVersion);
      transport.onmessage = (message) => {
        if ('id' in message && 'result' in message && initializeIds.delete(message.id as string)) {
          const version = (message.result as { protocolVersion?: unknown }).protocolVersion;
          if (typeof version === 'string') {
            protocolVersion = version;
            transport.setProtocolVersion?.(version);
          }
        }
        void deps.downstream.send(message);
      };
      transport.onerror = (error) => deps.note(`rigready bridge: ${error.message}`);
      transport.onclose = drop;
      return connected;
    });
    return upstream;
  };

  return new Promise<void>((resolve) => {
    deps.downstream.onmessage = (message) => {
      void (async () => {
        if (isRequest(message) && message.method === 'initialize') initializeIds.add(message.id);
        const connected = await open();
        if (!connected.ok) {
          deps.note(`rigready bridge: ${connected.error.message}`);
          await answerError(message, `${NOT_RUNNING} (${connected.error.message})`);
          return;
        }
        try {
          await connected.value.send(message);
        } catch (e) {
          // RigReady went away (quit, or the server was turned off): the next message reconnects.
          drop();
          const text = e instanceof Error ? e.message : String(e);
          deps.note(`rigready bridge: ${text}`);
          await answerError(message, `${NOT_RUNNING} (${text})`);
        }
      })();
    };
    deps.downstream.onclose = () => {
      void upstream?.then((u) => (u.ok ? u.value.close() : undefined));
      resolve();
    };
    void deps.downstream.start();
  });
}

/** Where the running RigReady listens, from its endpoint file, or why it cannot be reached. */
export function endpointUrl(endpoint: Endpoint | undefined): Result<URL> {
  if (!endpoint || !endpoint.running) return err('mcp.notRunning', 'No MCP server is listening.');
  return ok(new URL(`http://127.0.0.1:${endpoint.port}${MCP_PATH}`));
}
