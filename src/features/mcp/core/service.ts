import path from 'node:path';
import { BRIDGE_TOKEN_FILE } from '../../../core/mcpBridge';
import { LATEST_PROTOCOL_VERSION, type McpServerFactory } from '@modelcontextprotocol/server';
import type { ContractRegistry } from '../../../core/contracts';
import { JsonStore } from '../../../core/jsonStore';
import type { Logger } from '../../../core/logger';
import type {
  HostCaller,
  HostedResult,
  HostedTool,
  McpRegistry,
  ToolHost,
} from '../../../core/mcp';
import type { Ports } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import type { ChannelDef, Envelope } from '../../../shared/ipc';
import type { McpStatus, PairingView } from '../contract';
import { createServerFactory } from '../server/build';
import { McpHost, type Listening } from '../server/host';
import { ActivityLog, type ActivityEntry } from './activity';
import { buildCatalogue, catalogueProblems, type Catalogue, type Surface } from './catalogue';
import { clientConfig, CLIENT_KINDS, type ClientKind } from './clientConfig';
import {
  claudeCodeAddArgs,
  claudeCodeRemoveArgs,
  clientDef,
  configPlan,
  connectedIn,
  detectClient,
  detectClients,
  installLink,
  type ConnectClient,
  type DetectedClient,
} from './connect';
import { changePreview } from '../../../core/files/preview';
import type { ChangePreview } from '../../../shared/changePreview';
import { Confirmations, type ConfirmOutcome, type ConfirmRequest } from './confirm';
import { builtinTools } from './curated';
import { planToolCall } from './dispatch';
import { Gate } from './gate';
import { instructions } from './guide';
import { bundledManual, type ManualPage } from './manual';
import { Pairings, type PairingMatch } from './pairings';
import { PROMPTS } from './prompts';
import { builtinResources } from './resources';
import {
  EndpointSchema,
  endpointFile,
  mcpStore,
  type ConfirmPolicySchema,
  type McpStoreData,
} from './store';
import type { z } from 'zod';

/**
 * The MCP server as one object the feature's main.ts holds: the settings, the pairings,
 * the listener, the gate, and what the Settings page shows. Nothing listens until the
 * user turns it on; what listens is torn down on quit.
 */

/** Seconds a question waits for the user before it is a no. */
export const CONFIRM_SECONDS = 60;

/** A flood of calls over the rate limit leaves one line in the log for each assistant in this time. */
const RATE_LINE_EVERY_MS = 10_000;

export interface ServiceDeps {
  ports: Ports;
  log: Logger;
  contracts: ContractRegistry;
  registry: McpRegistry;
  invoke(channel: string, input: unknown): Promise<Envelope>;
  version(): string;
  emit: {
    confirm(request: ConfirmRequest): void;
    confirmSettled(id: string, outcome: ConfirmOutcome): void;
    activity(entry: ActivityEntry): void;
    changed(): void;
  };
  /** Brings RigReady's window forward so a question is seen. */
  showWindow(): Promise<void>;
  manual?(): ManualPage[];
}

export class McpService {
  readonly store: JsonStore<ReturnType<typeof mcpStore> extends JsonStore<infer S> ? S : never>;
  readonly pairings: Pairings;
  readonly activity = new ActivityLog();
  readonly confirmations: Confirmations;
  readonly gate: Gate;
  readonly host: McpHost;
  private readonly endpoint: JsonStore<typeof EndpointSchema>;
  private cached: { surface: Surface; catalogue: Catalogue } | undefined;
  private problem: string | undefined;
  private stopActivity: (() => void) | undefined;

  constructor(private readonly deps: ServiceDeps) {
    this.store = mcpStore(deps.ports.files, deps.ports.folders);
    this.endpoint = new JsonStore(
      deps.ports.files,
      endpointFile(deps.ports.folders),
      EndpointSchema
    );
    const tokenFile = path.join(deps.ports.folders.dataRoot(), BRIDGE_TOKEN_FILE);
    this.pairings = new Pairings(
      this.store,
      {
        read: async () => {
          if (!(await deps.ports.files.exists(tokenFile))) return ok(undefined);
          const text = await deps.ports.files.readText(tokenFile);
          return text.ok ? ok(text.value.trim()) : text;
        },
        write: async (token) => {
          const written = await deps.ports.files.write(tokenFile, token, {
            reason: 'Token for RigReady.exe --mcp',
          });
          return written.ok ? ok(undefined) : written;
        },
      },
      deps.ports.clock
    );
    this.confirmations = new Confirmations({
      now: () => deps.ports.clock.now(),
      show: (request) => {
        deps.emit.confirm(request);
        void deps.showWindow();
      },
      settled: (id, outcome) => deps.emit.confirmSettled(id, outcome),
    });
    this.gate = new Gate({
      clock: deps.ports.clock,
      activity: this.activity,
      policy: async () => {
        const data = await this.store.read();
        return data.ok ? data.value.confirm : 'ask';
      },
      confirm: (question, signal) =>
        this.confirmations.ask({ ...question, seconds: CONFIRM_SECONDS }, signal),
      invoke: (channel, input) => deps.invoke(channel, input),
      journalGroupIds: async () => {
        const groups = await deps.ports.files.journalGroups();
        return groups.ok ? groups.value.map((g) => g.id) : [];
      },
      markActor: async (groupIds, client) => {
        const marked = await deps.ports.files.markActor(groupIds, client);
        if (!marked.ok) deps.log.warn('could not name the assistant in the journal', marked.error);
      },
      noteCall: async (id) => {
        // The window hears of a request when it arrives, before its call is counted: told again
        // here, or the count it shows stays one call behind.
        if (await this.pairings.noteCall(id)) deps.emit.changed();
      },
    });
    this.stopActivity = this.activity.onRecord((entry) => {
      deps.emit.activity(entry);
      this.logCall(entry);
    });
    const manual = deps.manual ?? bundledManual;
    const { resources, templates } = builtinResources({
      manual,
      reference: () => this.catalogue().reference,
      activity: this.activity,
      readFile: (file) => deps.ports.files.readText(file),
    });
    for (const tool of builtinTools({ manual })) deps.registry.registerTool(tool);
    for (const resource of resources) deps.registry.registerResource(resource);
    for (const template of templates) deps.registry.registerResourceTemplate(template);
    for (const prompt of PROMPTS) deps.registry.registerPrompt(prompt);
    deps.registry.provideHost(this.toolHost());
    this.host = new McpHost({
      log: deps.log,
      factory: this.factory(),
      identify: (token) => this.pairings.identify(token),
      onRequest: () => deps.emit.changed(),
    });
  }

  /** When a call over the rate limit was last written to the log, by assistant. */
  private readonly rateLines = new Map<string, number>();

  /**
   * One line in the log for a call an assistant made: who, which tool and channel, how it
   * ended and how long it took, and for one that did not work, why. A read that worked is in
   * the detailed log only. Never the call's input or its answer. A flood over the rate limit
   * writes one line every ten seconds, not one a call.
   */
  private logCall(entry: ActivityEntry): void {
    const { log, ports } = this.deps;
    const line = {
      client: entry.client,
      tool: entry.tool,
      ...(entry.channel ? { channel: entry.channel } : {}),
      tier: entry.tier,
      outcome: entry.outcome,
      ms: entry.ms,
      summary: entry.summary,
    };
    if (entry.outcome === 'ok') {
      if (entry.tier === 'read') log.debug('an assistant call ran', line);
      else log.info('an assistant call ran', line);
      return;
    }
    if (entry.outcome === 'rate') {
      const now = ports.clock.now().getTime();
      const last = this.rateLines.get(entry.client);
      if (last !== undefined && now - last < RATE_LINE_EVERY_MS) return;
      this.rateLines.set(entry.client, now);
    }
    log.warn('an assistant call did not go through', { ...line, message: entry.message });
  }

  /** The surface the settings name right now; the catalogue is rebuilt when it changes. */
  private surface: Surface = 'guided';

  catalogue(): Catalogue {
    if (this.cached && this.cached.surface === this.surface) return this.cached.catalogue;
    const catalogue = buildCatalogue({
      contracts: this.deps.contracts.all(),
      registry: this.deps.registry,
      surface: this.surface,
    });
    const problems = catalogueProblems(catalogue);
    if (problems.length > 0) this.deps.log.warn('mcp catalogue problems', problems);
    this.cached = { surface: this.surface, catalogue };
    return catalogue;
  }

  /** The guided surface, whatever the MCP server's own setting: what the built-in assistant is offered. */
  private guided: Catalogue | undefined;

  guidedCatalogue(): Catalogue {
    this.guided ??= buildCatalogue({
      contracts: this.deps.contracts.all(),
      registry: this.deps.registry,
      surface: 'guided',
    });
    return this.guided;
  }

  private channelDef(channel: string): ChannelDef | undefined {
    const [feature, key] = channel.split(':');
    return feature && key ? this.deps.contracts.get(feature)?.channels[key] : undefined;
  }

  /**
   * The catalogue and the gate for an assistant inside the app. The same tools on the guided
   * surface, the same arguments check, the same gate (and so the same confirm policy, rate
   * limit, one change at a time, activity record and Safety page name). It works whether or
   * not the MCP server listens: nothing here goes over the network.
   */
  toolHost(): ToolHost {
    return {
      tools: (): HostedTool[] =>
        this.guidedCatalogue().tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          tier: t.tier,
          inputSchema: t.inputSchema,
        })),
      call: async (caller: HostCaller, name: string, args: unknown): Promise<HostedResult> => {
        const catalogue = this.guidedCatalogue();
        const spec = catalogue.tools.find((t) => t.name === name);
        if (!spec) {
          return err(
            'mcp.tool',
            `There is no tool "${name}".`,
            `Tools: ${catalogue.tools.map((t) => t.name).join(', ')}.`
          );
        }
        const planned = planToolCall(spec, args, {
          catalogue,
          channelDef: (channel) => this.channelDef(channel),
        });
        if (!planned.ok) return planned;
        const outcome = await this.gate.call(
          { pairingId: caller.id, client: caller.name, signal: caller.signal },
          planned.value
        );
        // What was really called, as the record has it: the channel and its tier for a call
        // of one channel, so the caller can show a read as a read.
        const { tier, summary, channel } = outcome.activity;
        const made = { tier, summary, ...(channel ? { channel } : {}) };
        return outcome.ok
          ? { ...ok(outcome.value), made }
          : { ok: false, error: outcome.error, made };
      },
    };
  }

  /** A server factory for the surface the settings name now. */
  private factory(): McpServerFactory {
    return createServerFactory({
      version: this.deps.version(),
      instructions: instructions({ version: this.deps.version(), surface: this.surface }),
      catalogue: () => this.catalogue(),
      channelDef: (channel) => this.channelDef(channel),
      resources: this.deps.registry.resources(),
      templates: this.deps.registry.resourceTemplates(),
      prompts: this.deps.registry.prompts(),
      gate: this.gate,
      log: this.deps.log,
    });
  }

  /** At startup: listen when the settings say so. Nothing is written when the server is off. */
  async start(): Promise<void> {
    const data = await this.store.read();
    if (!data.ok) {
      this.deps.log.warn('the MCP settings could not be read', data.error);
      this.problem = data.error.message;
      return;
    }
    this.surface = data.value.surface;
    if (!data.value.enabled) return;
    await this.listen(data.value);
  }

  private async listen(data: McpStoreData): Promise<Result<Listening>> {
    const bridge = await this.pairings.ensureBridge();
    if (!bridge.ok) {
      this.problem = bridge.error.message;
      return bridge;
    }
    this.surface = data.surface;
    // Built now, when every feature has registered what it offers.
    this.host.replaceFactory(this.factory());
    const listening = await this.host.start(data.port);
    if (!listening.ok) {
      this.problem = listening.error.message;
      this.deps.log.warn('the MCP server could not start', listening.error);
      return listening;
    }
    this.problem = undefined;
    const written = await this.endpoint.write({
      running: true,
      port: listening.value.port,
      pid: process.pid,
      startedAt: this.deps.ports.clock.now().toISOString(),
      protocolVersion: LATEST_PROTOCOL_VERSION,
      version: this.deps.version(),
    });
    if (!written.ok)
      this.deps.log.warn('the MCP endpoint file could not be written', written.error);
    this.deps.emit.changed();
    return listening;
  }

  async stop(): Promise<void> {
    this.confirmations.dropAll();
    this.stopActivity?.();
    this.stopActivity = undefined;
    if (this.host.current()) {
      await this.host.stop();
      const current = await this.endpoint.read();
      if (current.ok && current.value.running) {
        await this.endpoint.write({ ...current.value, running: false });
      }
    }
  }

  async status(): Promise<Result<McpStatus>> {
    const data = await this.store.read();
    if (!data.ok) return data;
    const listening = this.host.current();
    const catalogue = this.catalogue();
    const self = this.deps.ports.shortcuts.self();
    return ok({
      enabled: data.value.enabled,
      running: listening !== undefined,
      port: data.value.port,
      ...(listening ? { endpoint: { url: listening.url, port: listening.port } } : {}),
      ...(this.problem && data.value.enabled ? { problem: this.problem } : {}),
      confirm: data.value.confirm,
      surface: data.value.surface,
      pairings: data.value.pairings.map(view),
      requests: this.host.requests,
      ...(this.host.lastRequestAt ? { lastRequestAt: this.host.lastRequestAt } : {}),
      self: { exe: self.exe, args: self.args },
      catalogue: {
        tools: catalogue.tools.length,
        curated: catalogue.tools.filter((t) => t.kind === 'curated').length,
        channels: catalogue.reference.filter((r) => r.tier !== 'off').length,
        offChannels: catalogue.reference.filter((r) => r.tier === 'off').length,
        resources:
          this.deps.registry.resources().length + this.deps.registry.resourceTemplates().length,
        prompts: this.deps.registry.prompts().length,
        undescribed: new Set([...catalogue.derived.undescribed, ...catalogue.derived.untiered])
          .size,
      },
      activity: this.activity.count(),
      pending: this.confirmations.open(),
    });
  }

  async enable(): Promise<Result<McpStatus>> {
    const saved = await this.store.update((data) => ({ ...data, enabled: true }));
    if (!saved.ok) return saved;
    const listening = await this.listen(saved.value);
    if (!listening.ok) return listening;
    return this.status();
  }

  async disable(): Promise<Result<McpStatus>> {
    const saved = await this.store.update((data) => ({ ...data, enabled: false }));
    if (!saved.ok) return saved;
    await this.host.stop();
    const current = await this.endpoint.read();
    if (current.ok && current.value.running) {
      await this.endpoint.write({ ...current.value, running: false });
    }
    this.problem = undefined;
    this.deps.emit.changed();
    return this.status();
  }

  async setOptions(options: {
    confirm?: z.infer<typeof ConfirmPolicySchema>;
    surface?: Surface;
    port?: number;
  }): Promise<Result<McpStatus>> {
    const before = await this.store.read();
    if (!before.ok) return before;
    const saved = await this.store.update((data) => ({
      ...data,
      ...(options.confirm !== undefined ? { confirm: options.confirm } : {}),
      ...(options.surface !== undefined ? { surface: options.surface } : {}),
      ...(options.port !== undefined ? { port: options.port } : {}),
    }));
    if (!saved.ok) return saved;
    this.surface = saved.value.surface;
    const restart =
      saved.value.enabled &&
      this.host.current() !== undefined &&
      (saved.value.port !== before.value.port || saved.value.surface !== before.value.surface);
    if (restart) {
      await this.host.stop();
      const listening = await this.listen(saved.value);
      if (!listening.ok) return listening;
    }
    this.deps.emit.changed();
    return this.status();
  }

  async pair(
    name: string
  ): Promise<Result<{ pairing: PairingView; token: string; status: McpStatus }>> {
    const paired = await this.pairings.pairHttp(name);
    if (!paired.ok) return paired;
    this.deps.emit.changed();
    const status = await this.status();
    if (!status.ok) return status;
    return ok({
      pairing: view(paired.value.pairing),
      token: paired.value.token,
      status: status.value,
    });
  }

  async revoke(id: string): Promise<Result<McpStatus>> {
    const removed = await this.pairings.revoke(id);
    if (!removed.ok) return removed;
    this.deps.emit.changed();
    return this.status();
  }

  async rotateBridgeToken(): Promise<Result<McpStatus>> {
    const remade = await this.pairings.ensureBridge({ rotate: true });
    if (!remade.ok) return remade;
    this.deps.emit.changed();
    return this.status();
  }

  async clientConfigText(
    kind: ClientKind,
    token?: string
  ): Promise<Result<{ text: string; hint: string }>> {
    const data = await this.store.read();
    if (!data.ok) return data;
    const self = this.deps.ports.shortcuts.self();
    const port = this.host.current()?.port ?? data.value.port;
    const entry = CLIENT_KINDS.find((c) => c.kind === kind);
    if (!entry) return err('mcp.client', `Unknown client "${kind}".`);
    return ok({
      text: clientConfig(kind, {
        exe: self.exe,
        args: self.args,
        port,
        ...(token ? { token } : {}),
      }),
      hint: entry.sub,
    });
  }

  private env() {
    return { files: this.deps.ports.files, folders: this.deps.ports.folders };
  }

  private self(): { exe: string; args: string[] } {
    const self = this.deps.ports.shortcuts.self();
    return { exe: self.exe, args: self.args };
  }

  /** The AI assistants found on this PC and whether RigReady is in each. Reads only. */
  async clients(): Promise<Result<{ clients: DetectedClient[] }>> {
    return ok({ clients: await detectClients(this.env(), this.self()) });
  }

  /** What connecting a client that is connected by a file change would write. */
  async connectPreview(id: ConnectClient): Promise<Result<ChangePreview>> {
    const plan = await configPlan(this.env(), id, this.self());
    if (!plan.ok) return plan;
    return changePreview(
      this.deps.ports.files,
      [{ path: plan.value.file, content: plan.value.text }],
      () => `${plan.value.title}'s MCP servers, with RigReady added`
    );
  }

  /**
   * Connects one assistant: turns the server on when it is off (the bridge is paired with
   * it), then does what that assistant takes. Never says it is connected unless the file
   * reads back with RigReady in it; a link is handed over, and says only that.
   */
  async connect(id: ConnectClient): Promise<
    Result<{
      client: ConnectClient;
      done: 'written' | 'already' | 'linkOpened' | 'commandRan';
      message: string;
      file?: string;
      output?: string;
      status: McpStatus;
    }>
  > {
    const def = clientDef(id);
    const env = this.env();
    const self = this.self();
    const detected = await detectClient(env, def, self);
    if (!detected) return err('mcp.connect', `${def.title} was not found on this PC.`);
    if (def.method === 'paste') {
      return err(
        'mcp.connect',
        `${def.title} is connected by pasting the text into its own settings.`
      );
    }
    if (detected.problem) return err('mcp.clientFile', detected.problem);
    const data = await this.store.read();
    if (!data.ok) return data;
    if (!data.value.enabled || !this.host.current()) {
      const on = await this.enable();
      if (!on.ok) return on;
    }
    const finish = async (
      done: 'written' | 'already' | 'linkOpened' | 'commandRan',
      message: string,
      extra: { file?: string; output?: string } = {}
    ) => {
      const status = await this.status();
      if (!status.ok) return status;
      return ok({ client: id, done, message, ...extra, status: status.value });
    };

    switch (def.method) {
      case 'config': {
        const plan = await configPlan(env, id, self);
        if (!plan.ok) return plan;
        const { file, text, changed } = plan.value;
        if (!changed)
          return finish('already', `RigReady is already in ${def.title}'s settings.`, { file });
        const group = this.deps.ports.files.beginGroup(`Connect ${def.title} to RigReady`);
        const written = await this.deps.ports.files.write(file, text, {
          reason: `Add RigReady to ${def.title}'s MCP servers`,
          group,
        });
        if (!written.ok) return written;
        if (!(await connectedIn(env, id, self))) {
          return err(
            'mcp.connect',
            `${file} does not hold RigReady after the change. Another program may have put it back; is ${def.title} open?`
          );
        }
        return finish('written', `Added RigReady to ${def.title}. ${def.after}`, { file });
      }
      case 'link': {
        if (detected.state === 'connected') {
          return finish('already', `RigReady is already in ${def.title}'s settings.`);
        }
        const link = installLink(id, self);
        if (!link) return err('mcp.connect', `${def.title} has no install link.`);
        const opened = await this.deps.ports.window.openLink(link);
        if (!opened.ok) return opened;
        return finish('linkOpened', `Asked ${def.title} to add RigReady. ${def.after}`);
      }
      case 'command': {
        if (detected.state === 'connected') {
          return finish('already', `RigReady is already in ${def.title}'s settings.`);
        }
        if (!detected.cli) {
          return err(
            'mcp.connect',
            `The ${def.title} program was not found. Copy the command and run it in a terminal.`
          );
        }
        const outputs: string[] = [];
        if (detected.state === 'different') {
          const removed = await this.deps.ports.shell.run(detected.cli, claudeCodeRemoveArgs(), {
            timeoutMs: 60_000,
          });
          if (!removed.ok) return removed;
          outputs.push(removed.value.stdout, removed.value.stderr);
        }
        const ran = await this.deps.ports.shell.run(detected.cli, claudeCodeAddArgs(self), {
          timeoutMs: 60_000,
        });
        if (!ran.ok) return ran;
        outputs.push(ran.value.stdout, ran.value.stderr);
        const output = outputs
          .map((o) => o.trim())
          .filter(Boolean)
          .join('\n');
        if (ran.value.code !== 0) {
          return err(
            'mcp.connect',
            `${def.title} answered with exit code ${ran.value.code}.`,
            output
          );
        }
        if (!(await connectedIn(env, id, self))) {
          return err(
            'mcp.connect',
            `${def.title} ran, but RigReady is not in its settings afterwards.`,
            output
          );
        }
        return finish('commandRan', `Claude Code added RigReady for every folder. ${def.after}`, {
          output,
        });
      }
    }
  }

  answer(id: string, allow: boolean): boolean {
    return this.confirmations.answer(id, allow);
  }

  /** Who a token belongs to, for a test or the bridge. */
  identify(token: string): Promise<PairingMatch | undefined> {
    return this.pairings.identify(token);
  }
}

const view = (p: McpStoreData['pairings'][number]): PairingView => {
  const { tokenHash: _hash, ...rest } = p;
  return rest;
};
