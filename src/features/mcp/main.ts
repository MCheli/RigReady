import { bind, defineFeatureMain } from '../../core/feature';
import { ok } from '../../core/result';
import { mcpContract } from './contract';
import { McpService } from './core/service';
import { toolLine } from './server/build';

let service: McpService | undefined;

export default defineFeatureMain({
  id: 'mcp',
  setup(ctx) {
    const mcp = new McpService({
      ports: ctx.ports,
      log: ctx.log,
      contracts: ctx.contracts,
      registry: ctx.mcp,
      invoke: (channel, input) => ctx.invoke(channel, input),
      version: () => ctx.ports.updates.currentVersion(),
      emit: {
        confirm: (request) => ctx.emit(mcpContract, 'confirm', request),
        confirmSettled: (id, outcome) => ctx.emit(mcpContract, 'confirmSettled', { id, outcome }),
        activity: (entry) => ctx.emit(mcpContract, 'activity', entry),
        changed: () => ctx.emit(mcpContract, 'changed', {}),
      },
      showWindow: async () => {
        // The question is asked in RigReady's window: it comes forward, on a screen that is on.
        const shown = await ctx.invoke('fly:showMain');
        if (!shown.ok) ctx.log.warn('the window could not be shown for a question', shown.error);
      },
    });
    service = mcp;
    return [
      bind(mcpContract, {
        status: () => mcp.status(),
        enable: () => mcp.enable(),
        disable: () => mcp.disable(),
        setOptions: (options) => mcp.setOptions(options),
        pair: ({ name }) => mcp.pair(name),
        revoke: ({ id }) => mcp.revoke(id),
        rotateBridgeToken: () => mcp.rotateBridgeToken(),
        clientConfig: ({ kind, token }) => mcp.clientConfigText(kind, token),
        async copyClientConfig({ kind, token }) {
          const text = await mcp.clientConfigText(kind, token);
          if (!text.ok) return text;
          const copied = await ctx.ports.clipboard.writeText(text.value.text);
          return copied.ok ? ok({ copied: true }) : copied;
        },
        activity: async (input) => ok({ entries: mcp.activity.list(input?.limit ?? 50) }),
        catalogue: async () => ok({ tools: mcp.catalogue().tools.map(toolLine) }),
        answer: async ({ id, allow }) => ok({ answered: mcp.answer(id, allow) }),
      }),
    ];
  },
  start: () => service?.start(),
  async dispose() {
    await service?.stop();
    service = undefined;
  },
});
