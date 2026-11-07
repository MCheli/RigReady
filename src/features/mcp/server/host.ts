import http from 'node:http';
import { createMcpHandler, type McpServerFactory } from '@modelcontextprotocol/server';
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import type { Logger } from '../../../core/logger';
import { err, ok, type Result } from '../../../core/result';
import type { PairingMatch } from '../core/pairings';
import { MCP_PATH } from './constants';

/**
 * The listener: Streamable HTTP on 127.0.0.1 only, one endpoint, a bearer token from a
 * pairing on every request. In front of the protocol: the Host and Origin checks the
 * specification asks of a local server (a web page on another origin can never reach it,
 * even through DNS rebinding), then the token, then the body size. The SDK serves both
 * protocol eras from one factory: 2025-era clients (Claude Desktop, Claude Code, Cursor
 * today) statelessly, 2026-07-28 clients natively.
 */

/** Requests larger than this are refused before anything is parsed. */
export const MAX_BODY_BYTES = 1024 * 1024;

export interface HostDeps {
  log: Logger;
  factory: McpServerFactory;
  identify(token: string): Promise<PairingMatch | undefined>;
  /** Called for every request that passed the token check, with who it was. */
  onRequest?(pairing: PairingMatch): void;
}

export interface Listening {
  port: number;
  url: string;
}

export class McpHost {
  private server: http.Server | undefined;
  private handler: ReturnType<typeof createMcpHandler> | undefined;
  private listening: Listening | undefined;
  /** Requests that passed the token check, and when the last one came. */
  requests = 0;
  lastRequestAt: string | undefined;

  private factory: McpServerFactory;

  constructor(private readonly deps: HostDeps) {
    this.factory = deps.factory;
  }

  /** The servers made from now on come from this factory (the surface or the instructions changed). */
  replaceFactory(factory: McpServerFactory): void {
    this.factory = factory;
  }

  current(): Listening | undefined {
    return this.listening;
  }

  async start(port: number): Promise<Result<Listening>> {
    if (this.listening) return ok(this.listening);
    const handler = createMcpHandler((ctx) => this.factory(ctx), {
      legacy: 'stateless',
      maxRequestBodySize: MAX_BODY_BYTES,
      onerror: (error) => this.deps.log.warn('mcp request failed', error.message),
    });
    const node = toNodeHandler(handler, { maxRequestBodySize: MAX_BODY_BYTES });
    const checkHost = localhostHostValidation();
    const checkOrigin = localhostOriginValidation();
    const server = http.createServer((req, res) => {
      void this.serve(req, res, { node, checkHost, checkOrigin });
    });
    // The listener never keeps RigReady alive on its own: quitting is the app's decision.
    server.unref();
    const bound = await new Promise<Result<number>>((resolve) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        resolve(
          err(
            error.code === 'EADDRINUSE' ? 'mcp.portInUse' : 'mcp.listen',
            error.code === 'EADDRINUSE'
              ? `Port ${port} is in use by another program. Choose another port.`
              : `The MCP server could not listen on port ${port}.`,
            error.message
          )
        );
      });
      server.listen(port, '127.0.0.1', () => {
        const address = server.address();
        resolve(ok(typeof address === 'object' && address ? address.port : port));
      });
    });
    if (!bound.ok) {
      await handler.close();
      return bound;
    }
    this.server = server;
    this.handler = handler;
    this.listening = { port: bound.value, url: `http://127.0.0.1:${bound.value}${MCP_PATH}` };
    this.deps.log.info(`mcp server listening on ${this.listening.url}`);
    return ok(this.listening);
  }

  async stop(): Promise<void> {
    const server = this.server;
    const handler = this.handler;
    this.server = undefined;
    this.handler = undefined;
    this.listening = undefined;
    if (handler) await handler.close();
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Open keep-alive connections would otherwise hold the close for their timeout.
        server.closeAllConnections();
      });
      this.deps.log.info('mcp server stopped');
    }
  }

  private async serve(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    guards: {
      node: ReturnType<typeof toNodeHandler>;
      checkHost: (req: http.IncomingMessage, res: http.ServerResponse) => boolean;
      checkOrigin: (req: http.IncomingMessage, res: http.ServerResponse) => boolean;
    }
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== MCP_PATH) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `The MCP endpoint is ${MCP_PATH}.` }));
      return;
    }
    if (!guards.checkHost(req, res)) return;
    if (!guards.checkOrigin(req, res)) return;
    const header = req.headers['authorization'];
    const token =
      typeof header === 'string' && header.toLowerCase().startsWith('bearer ')
        ? header.slice(7).trim()
        : undefined;
    const pairing = token ? await this.deps.identify(token) : undefined;
    if (!pairing) {
      res.writeHead(401, {
        'content-type': 'application/json',
        'www-authenticate': 'Bearer realm="RigReady", error="invalid_token"',
      });
      res.end(
        JSON.stringify({
          error:
            'Not paired. Pair this assistant on RigReady\'s Settings page and send its token as "Authorization: Bearer <token>".',
        })
      );
      return;
    }
    this.requests++;
    this.lastRequestAt = new Date().toISOString();
    this.deps.onRequest?.(pairing);
    const withAuth = req as http.IncomingMessage & {
      auth?: { token: string; clientId: string; scopes: string[]; extra?: Record<string, unknown> };
    };
    // The protocol layer gets the pairing, not the token: handlers see who, never what.
    withAuth.auth = {
      token: '',
      clientId: pairing.id,
      scopes: [],
      extra: { name: pairing.name, kind: pairing.kind },
    };
    await guards.node(withAuth, res);
  }
}
