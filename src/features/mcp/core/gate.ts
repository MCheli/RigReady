import { runAsAssistant } from '../../../core/assistantScripts';
import type { McpCallContext } from '../../../core/mcp';
import type { Clock } from '../../../core/ports';
import { err, type Result, type RigError } from '../../../core/result';
import type { ChannelTier, Envelope } from '../../../shared/ipc';
import { ActivityLog, type ActivityEntry, type ActivityOutcome } from './activity';
import type { ConfirmOutcome } from './confirm';
import { gateDecision, type ConfirmPolicy } from './tiers';

/**
 * The one path every tool call takes. In order: the rate limit of the pairing, the tier of
 * the tool against the user's confirm policy (a read runs, a change or a launch may have
 * to be allowed in the window first), one change at a time across every assistant, the
 * work itself through the app's validated channels, and the record: what was asked, how
 * it ended, and which Safety page actions it left behind, under the assistant's name.
 *
 * Both doors use it: the MCP server (a paired assistant) and the built-in assistant of the
 * app (`McpService.host`, as `ctx.mcp.host()`), so a rule changed here holds for both.
 */

export interface Caller {
  pairingId: string;
  /** The pairing's name. */
  client: string;
  signal: AbortSignal;
}

export interface ToolCall {
  tool: string;
  tier: ChannelTier;
  /** One line for the question and the record ("Make DCS F/A-18C ready"). */
  summary: string;
  /**
   * The same line with what the app knows put in: a setup's name for the id the assistant
   * gave. It runs before the user is asked, so it only ever reads. When it fails, `summary`
   * stands.
   */
  describe?: (ctx: McpCallContext) => Promise<string>;
  /** The call as it was made (a channel and its input), shown small under the line in words. */
  detail?: string;
  channel?: string;
  work(ctx: McpCallContext): Promise<Result<unknown>>;
}

export type CallOutcome =
  | { ok: true; value: unknown; activity: ActivityEntry }
  | { ok: false; error: RigError; activity: ActivityEntry };

export interface GateDeps {
  clock: Clock;
  activity: ActivityLog;
  policy(): Promise<ConfirmPolicy>;
  confirm(
    question: {
      client: string;
      tool: string;
      summary: string;
      detail?: string;
      tier: 'change' | 'launch';
    },
    signal: AbortSignal
  ): Promise<ConfirmOutcome>;
  invoke(channel: string, input: unknown): Promise<Envelope>;
  /** The ids of the journal's actions, newest first, for the before-and-after of a change. */
  journalGroupIds(): Promise<string[]>;
  /** Names the assistant beside the actions a change left in the journal, for the Safety page. */
  markActor(groupIds: string[], client: string): Promise<void>;
  /** Counts a call under its pairing. Every call that got past the rate limit, however it ended. */
  noteCall(pairingId: string): Promise<void>;
}

/** The longest line a question or a record shows. */
const LINE_LENGTH = 200;

/** Calls a pairing may make: this many at once, refilled at this rate. */
export const RATE_BURST = 30;
export const RATE_PER_SECOND = 10;

interface Bucket {
  tokens: number;
  at: number;
}

export class Gate {
  private readonly buckets = new Map<string, Bucket>();
  /** The change that is running, if one is: its summary, for the refusal. */
  private running: string | undefined;

  constructor(private readonly deps: GateDeps) {}

  /** A channel call outside a tool (listing a resource template): validated like any other, not recorded. */
  invoke(channel: string, input: unknown): Promise<Envelope> {
    return this.deps.invoke(channel, input);
  }

  private allowed(pairingId: string): boolean {
    const now = this.deps.clock.now().getTime();
    const bucket = this.buckets.get(pairingId) ?? { tokens: RATE_BURST, at: now };
    const refill = ((now - bucket.at) / 1000) * RATE_PER_SECOND;
    bucket.tokens = Math.min(RATE_BURST, bucket.tokens + Math.max(0, refill));
    bucket.at = now;
    if (bucket.tokens < 1) {
      this.buckets.set(pairingId, bucket);
      return false;
    }
    bucket.tokens -= 1;
    this.buckets.set(pairingId, bucket);
    return true;
  }

  async call(caller: Caller, call: ToolCall): Promise<CallOutcome> {
    const started = this.deps.clock.now();
    const ctx: McpCallContext = {
      client: caller.client,
      invoke: (channel, input) => this.deps.invoke(channel, input),
      signal: caller.signal,
    };
    /** What the question and the record say: the call's plain line, until its own is worked out. */
    let summary = call.summary;
    const record = (
      outcome: ActivityOutcome,
      message: string,
      journalGroups: string[] = []
    ): ActivityEntry => {
      const entry: ActivityEntry = {
        id: this.deps.activity.nextId(),
        time: started.toISOString(),
        client: caller.client,
        tool: call.tool,
        ...(call.channel ? { channel: call.channel } : {}),
        tier: call.tier,
        summary,
        ...(call.detail ? { detail: call.detail } : {}),
        outcome,
        message,
        ms: Math.max(0, this.deps.clock.now().getTime() - started.getTime()),
        journalGroups,
      };
      this.deps.activity.record(entry);
      return entry;
    };
    const refuse = (outcome: ActivityOutcome, code: string, message: string): CallOutcome => ({
      ok: false,
      error: { code, message },
      activity: record(outcome, message),
    });

    if (!this.allowed(caller.pairingId)) {
      return refuse(
        'rate',
        'mcp.rate',
        `Too many calls at once from ${caller.client}: at most ${RATE_BURST} in a burst, ${RATE_PER_SECOND} a second after that.`
      );
    }
    // Counted from here on, so a call the user said no to is in the pairing's count as it is in
    // the list of what assistants did. A call over the rate limit is not: a flood writes nothing.
    void this.deps.noteCall(caller.pairingId);
    const describe = call.describe;
    if (describe) {
      try {
        // As the work is: whatever this reads knows an assistant asked.
        const line = (await runAsAssistant(caller.client, () => describe(ctx)))
          .replace(/\s+/g, ' ')
          .trim();
        if (line !== '') summary = line.slice(0, LINE_LENGTH);
      } catch {
        // The plain line stands.
      }
    }
    const decision = gateDecision(call.tier, await this.deps.policy());
    if (decision === 'refuse') {
      return refuse('refused', 'mcp.off', `${call.tool} is not offered to assistants.`);
    }
    if (decision === 'confirm') {
      const answer = await this.deps.confirm(
        {
          client: caller.client,
          tool: call.tool,
          summary,
          ...(call.detail ? { detail: call.detail } : {}),
          tier: call.tier === 'launch' ? 'launch' : 'change',
        },
        caller.signal
      );
      if (answer === 'denied') {
        return refuse('denied', 'mcp.denied', `The user did not allow "${summary}" in RigReady.`);
      }
      if (answer === 'timeout') {
        return refuse(
          'timeout',
          'mcp.timeout',
          `RigReady asked the user whether to allow "${summary}" and got no answer in time. Ask them to look at RigReady's window, then try again.`
        );
      }
    }
    const changes = call.tier !== 'read';
    if (changes && this.running !== undefined) {
      return refuse(
        'busy',
        'mcp.busy',
        `RigReady is still busy with "${this.running}". Wait for it to finish, then try again.`
      );
    }
    if (changes) this.running = summary;
    try {
      const before = changes ? new Set(await this.deps.journalGroupIds()) : undefined;
      let result: Result<unknown>;
      try {
        // Whatever the work calls knows an assistant asked: a script an assistant wrote is
        // then refused, so it only ever runs from the window, where the user is asked.
        result = await runAsAssistant(caller.client, () => call.work(ctx));
      } catch (e) {
        result = err(
          'mcp.tool',
          `${call.tool} failed unexpectedly.`,
          e instanceof Error ? e.message : String(e)
        );
      }
      const groups = before
        ? (await this.deps.journalGroupIds()).filter((id) => !before.has(id))
        : [];
      if (groups.length > 0) await this.deps.markActor(groups, caller.client);
      if (!result.ok) {
        const message = result.error.detail
          ? `${result.error.message} ${result.error.detail}`
          : result.error.message;
        return { ok: false, error: result.error, activity: record('error', message, groups) };
      }
      return {
        ok: true,
        value: result.value,
        activity: record('ok', oneLine(result.value), groups),
      };
    } finally {
      if (changes) this.running = undefined;
    }
  }
}

/** What an answer says, in one short line for the record. */
export function oneLine(value: unknown): string {
  if (value === null || value === undefined) return 'Done';
  if (typeof value === 'string') return value.slice(0, 200);
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of ['headline', 'message', 'summary', 'line']) {
      if (typeof object[key] === 'string') return (object[key] as string).slice(0, 200);
    }
    if (typeof object['ready'] === 'boolean') return object['ready'] ? 'Ready' : 'Not ready';
    if (Array.isArray(value)) return `${value.length} items`;
    const keys = Object.keys(object);
    if (keys.length === 1 && Array.isArray(object[keys[0]!])) {
      return `${(object[keys[0]!] as unknown[]).length} ${keys[0]}`;
    }
    return `${Object.keys(object).length} fields`;
  }
  return String(value);
}
