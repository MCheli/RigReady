import path from 'node:path';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { err, ok } from '../core/result';
import {
  BRIDGE_TOKEN_FILE,
  ENDPOINT_FILE,
  EndpointSchema,
  endpointUrl,
  runBridge,
} from '../core/mcpBridge';
import { processStdio } from '../platform/electron';
import { NodeRawFs } from '../platform/node';
import { WindowsKnownFolders } from '../platform/windows/knownFolders';

/** The flag that makes this start a stdio bridge to the running RigReady instead of the app. */
export const MCP_BRIDGE_ARG = '--mcp';

/**
 * `RigReady.exe --mcp`. Opens no window, takes no lock and changes nothing: it reads where
 * the running RigReady listens and the bridge's token (a file under the data root),
 * then passes messages between stdin/stdout and that endpoint. Stdout carries only the
 * protocol; everything else goes to stderr. Resolves when the client closes stdin.
 */
export async function runMcpBridge(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  // The data folder as the running app finds it (RIGREADY_HOME, else ~/.rigready).
  const root = new WindowsKnownFolders(env).dataRoot();
  const raw = new NodeRawFs();
  const stdio = processStdio();
  await runBridge({
    downstream: new StdioServerTransport(stdio.input, stdio.output),
    note: (line) => process.stderr.write(`${line}\n`),
    connect: async () => {
      let endpoint;
      try {
        endpoint = EndpointSchema.safeParse(
          JSON.parse(await raw.readText(path.join(root, ENDPOINT_FILE)))
        );
      } catch (e) {
        return err('mcp.notRunning', 'RigReady has not started its MCP server.', String(e));
      }
      const url = endpointUrl(endpoint.success ? endpoint.data : undefined);
      if (!url.ok) return url;
      let token: string;
      try {
        token = (await raw.readText(path.join(root, BRIDGE_TOKEN_FILE))).trim();
      } catch (e) {
        return err('mcp.noToken', 'The bridge has no token yet.', String(e));
      }
      const transport = new StreamableHTTPClientTransport(url.value, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      await transport.start();
      return ok(transport);
    },
  });
}
