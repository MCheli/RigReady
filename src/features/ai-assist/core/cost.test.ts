import { appendFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { AI_KEY_SECRET } from '../../../core/settings';
import { approximateCost, type Usage } from './anthropic';
import { type TurnOutcome, type TurnPreview } from './assistantModel';

/**
 * What a conversation costs, measured on the request bodies the assistant really builds:
 * the two questions of the owner's first session, played against a fake provider that
 * meters the way Anthropic publishes it (prompt caching by prefix, in the order tools,
 * system, messages; a breakpoint finds what was written at it or up to 20 blocks before it;
 * a write at 1.25x, a read at the cache price). Nothing leaves the fake Http port, and the
 * tools answer from the scenario's rig.
 *
 * The model is scripted, so this measures what RigReady sends for a given way of working,
 * not how a real model chooses to work. Two ways are played: the first session as it went
 * (the same tools in the same order), and the same two questions with the narrow tools the
 * instructions now name.
 *
 * Set RIGREADY_COST_REPORT to a file path to get the numbers written out.
 */
const KEY = 'sk-ant-unit-NOT-A-REAL-KEY-0000-abcd';
const MODEL = 'claude-opus-5-5';
/** Below this many tokens a prefix is not cached (Opus 5.5 and Sonnet 5.5). */
const MIN_CACHED = 512;
/** How far back from a breakpoint the provider looks for something it holds. */
const LOOKBACK = 20;
const tokensOf = (text: string): number => Math.ceil(text.length / 4);

/**
 * The same script and meter on the code before this change (commit 74a6386): only the
 * instructions and tool definitions were cached, and a tool answer was cut at 60,000
 * characters. What the budgets below are compared with.
 */
const BEFORE = {
  one: { requests: 6, tokens: 79_290, cost: 0.2841 },
  two: { requests: 4, tokens: 111_797, cost: 0.4178 },
};

let app: WiredApp | undefined;
afterEach(async () => {
  if (app) {
    for (const feature of app.wiring.features) await feature.dispose?.();
    await app.cleanup();
    app = undefined;
  }
});

interface Body {
  system: { text: string; cache_control?: unknown }[];
  tools: unknown[];
  messages: { role: string; content: Record<string, unknown>[] }[];
}

/** Meters request bodies as the Messages API does. */
class Meter {
  private readonly written = new Set<string>();

  bill(body: Body, output: number): Usage {
    // The prompt in the order it is rendered, cut where a cache breakpoint may sit.
    const pieces: { text: string; marked: boolean }[] = [];
    const system = body.system.map((s) => s.text).join('\n');
    pieces.push({
      text: JSON.stringify(body.tools) + system,
      marked: body.system.some((s) => s.cache_control !== undefined),
    });
    for (const message of body.messages) {
      for (const block of message.content) {
        const { cache_control: marker, ...rest } = block;
        pieces.push({
          text: `${message.role}:${JSON.stringify(rest)}`,
          marked: marker !== undefined,
        });
      }
    }
    let prefix = '';
    const ends = pieces.map((piece) => {
      prefix += piece.text;
      return { prefix, marked: piece.marked };
    });
    let read = 0;
    let lastMarked = 0;
    const marks: string[] = [];
    ends.forEach((end, at) => {
      if (!end.marked) return;
      const size = tokensOf(end.prefix);
      if (size < MIN_CACHED) return;
      for (let back = at; back >= Math.max(0, at - LOOKBACK); back--) {
        const earlier = ends[back]?.prefix ?? '';
        if (this.written.has(earlier)) {
          read = Math.max(read, tokensOf(earlier));
          break;
        }
      }
      lastMarked = size;
      marks.push(end.prefix);
    });
    for (const mark of marks) this.written.add(mark);
    const total = tokensOf(prefix);
    return {
      input: total - lastMarked,
      cacheRead: read,
      cacheWrite: lastMarked - read,
      output,
    };
  }
}

interface Turn {
  /** The tools the model asks for in this answer. */
  calls?: { name: string; input: unknown }[];
  say?: string;
  /** Tokens of the model's answer (thinking included), as it would be billed. */
  out: number;
}

interface Measured {
  chars: number;
  usage: Usage;
  cost: number;
  /** What RigReady said this request would cost to read, before it was sent. */
  estimate: number | null;
}

interface Asked {
  requests: Measured[];
  outcome: TurnOutcome;
  previews: TurnPreview[];
  /** The request the ceiling held back, when it did. */
  held?: TurnPreview;
}

let toolId = 0;

/** What the provider answers to one request: the scripted turn, billed by the meter. */
function answer(running: WiredApp, turn: Turn, usage: Usage): void {
  const content: unknown[] = [];
  if (turn.say) content.push({ type: 'text', text: turn.say });
  for (const call of turn.calls ?? []) {
    content.push({ type: 'tool_use', id: `tu_${++toolId}`, name: call.name, input: call.input });
  }
  running.ports.http.scripts.push({
    match: { url: 'api.anthropic.com/v1/messages', method: 'POST' },
    times: 1,
    response: {
      status: 200,
      headers: {},
      json: {
        id: 'msg_unit',
        type: 'message',
        role: 'assistant',
        model: MODEL,
        content,
        stop_reason: turn.calls?.length ? 'tool_use' : 'end_turn',
        usage: {
          input_tokens: usage.input,
          output_tokens: usage.output,
          cache_creation_input_tokens: usage.cacheWrite,
          cache_read_input_tokens: usage.cacheRead,
        },
      },
    },
  });
}

/** One question, sent the way the panel sends it; stops where the ceiling holds a request back. */
async function ask(
  running: WiredApp,
  meter: Meter,
  text: string,
  turns: Turn[],
  conversationId?: string
): Promise<Asked> {
  let preview: TurnPreview | undefined = await running.invoke<TurnPreview>(
    'ai-assist:assistantPrepare',
    { text, ...(conversationId ? { conversationId } : {}) }
  );
  const previews: TurnPreview[] = [];
  const requests: Measured[] = [];
  let outcome: TurnOutcome | undefined;
  for (const turn of turns) {
    if (!preview) throw new Error('The conversation ended before the script did.');
    previews.push(preview);
    if (preview.overCeiling) {
      if (!outcome) throw new Error('The first request of a question was held back.');
      return { requests, outcome, previews, held: preview };
    }
    const body = JSON.parse(preview.body) as Body;
    const usage = meter.bill(body, turn.out);
    answer(running, turn, usage);
    outcome = await running.invoke<TurnOutcome>('ai-assist:assistantSend', {
      requestId: preview.requestId,
    });
    requests.push({
      chars: JSON.stringify(body).length,
      usage,
      cost: approximateCost(MODEL, usage) ?? 0,
      estimate: preview.approxCost,
    });
    preview = outcome.next;
  }
  if (!outcome) throw new Error('Nothing was sent.');
  return { requests, outcome, previews };
}

const sum = (requests: Measured[]): { tokens: number; cost: number } => ({
  tokens: requests.reduce(
    (n, r) => n + r.usage.input + r.usage.cacheRead + r.usage.cacheWrite + r.usage.output,
    0
  ),
  cost: requests.reduce((n, r) => n + r.cost, 0),
});

const report = (name: string, requests: Measured[]): string => {
  const total = sum(requests);
  return [
    `${name}: ${requests.length} requests, ${total.tokens} tokens, $${total.cost.toFixed(4)}`,
    ...requests.map(
      (r, i) =>
        `  ${i + 1}. ${r.chars} chars; uncached ${r.usage.input}, written ${r.usage.cacheWrite}, read ${r.usage.cacheRead}, out ${r.usage.output}; $${r.cost.toFixed(4)} (shown before sending: $${(r.estimate ?? 0).toFixed(4)} to read)`
    ),
  ].join('\n');
};

function write(title: string, lines: string[]): void {
  const out = process.env['RIGREADY_COST_REPORT'];
  if (out) appendFileSync(out, [`== ${title}`, ...lines, '', ''].join('\n'));
}

/** What reading a request costs without the model's answer: what the page shows before sending. */
const readCost = (usage: Usage): number => approximateCost(MODEL, { ...usage, output: 0 }) ?? 0;

const QUESTION_ONE = 'Is TrackIR a required step for launching the F/A-18C setup?';
const QUESTION_TWO = 'Yes add trackir to this setup';

const PROPOSE = {
  name: 'setup_propose',
  input: {
    setup: 'dcs-f-a-18c',
    summary: 'Starts TrackIR before DCS, and closes it at Stand down.',
    addSteps: [
      {
        phase: 'preLaunch',
        type: 'process.launch',
        title: 'Start TrackIR',
        params: { exe: '{PROGRAMFILES(X86)}/NaturalPoint/TrackIR5/TrackIR5.exe' },
      },
    ],
  },
};
const ANSWER_ONE =
  'TrackIR is not a launch step of DCS F/A-18C. It is a required check: Make ready starts it when it is not running. See https://rigready.io/docs/setups/launch/';
const ANSWER_TWO = 'The change is in RigReady for you to look at. Press Save to keep it.';

/** The owner's first session as it went: the model reads widely before it answers. */
const WIDE_ONE: Turn[] = [
  {
    say: 'I will look at your setups and the manual.',
    calls: [
      { name: 'setups_list', input: {} },
      { name: 'manual_search', input: { query: 'TrackIR required launch step' } },
    ],
    out: 350,
  },
  { calls: [{ name: 'manual_read', input: { page: 'setups/launch' } }], out: 250 },
  { calls: [{ name: 'rigready_channels', input: { feature: 'profiles' } }], out: 250 },
  { calls: [{ name: 'rigready_call', input: { channel: 'profiles:list' } }], out: 300 },
  { calls: [{ name: 'rig_check', input: {} }], out: 250 },
  { say: ANSWER_ONE, out: 600 },
];
const WIDE_TWO: Turn[] = [
  {
    calls: [
      { name: 'rigready_call', input: { channel: 'profiles:types' } },
      { name: 'programs_find', input: { names: ['TrackIR'] } },
    ],
    out: 400,
  },
  { calls: [{ name: 'manual_read', input: { page: 'setups/checks' } }], out: 250 },
  { calls: [PROPOSE], out: 700 },
  { say: ANSWER_TWO, out: 250 },
];

/**
 * The same two questions the way the instructions now ask for: what is on the PC from the
 * tool that answers it, the manual by section before a change, everything known to be
 * needed in one turn.
 */
const NARROW_ONE: Turn[] = [
  { calls: [{ name: 'setup_read', input: { setup: 'F/A-18C' } }], out: 300 },
  { say: ANSWER_ONE, out: 600 },
];
const NARROW_TWO: Turn[] = [
  {
    calls: [
      { name: 'manual_search', input: { query: 'steps before launch' } },
      { name: 'programs_find', input: { names: ['TrackIR'] } },
    ],
    out: 400,
  },
  {
    calls: [
      { name: 'manual_read', input: { page: 'setups/launch', section: 'Steps before launch' } },
    ],
    out: 250,
  },
  { calls: [PROPOSE], out: 700 },
  { say: ANSWER_TWO, out: 250 },
];

async function started(): Promise<WiredApp> {
  const running = (app = await wiredApp('flying-all-good'));
  await running.ports.secrets.set(AI_KEY_SECRET, KEY);
  return running;
}

describe('ASSIST-005 what a conversation with the assistant costs', () => {
  it('the first session played again as it went costs less than half of what it did', async () => {
    const running = await started();
    // No ceiling: this measures the whole of it.
    await running.invoke('ai-assist:setQuestionCeiling', { dollars: 0 });
    const meter = new Meter();
    const one = await ask(running, meter, QUESTION_ONE, WIDE_ONE);
    const two = await ask(
      running,
      meter,
      QUESTION_TWO,
      WIDE_TWO,
      one.outcome.conversation.conversationId
    );
    write('the first session as it went, on this code', [
      report('question 1', one.requests),
      report('question 2', two.requests),
      `shown at the end: ${JSON.stringify(two.outcome.conversation.usage)}`,
    ]);
    expect(one.requests).toHaveLength(WIDE_ONE.length);
    expect(two.requests).toHaveLength(WIDE_TWO.length);

    // After the first request, what was sent before is read from the provider's cache:
    // only what the last round added is new.
    for (const request of [...one.requests.slice(1), ...two.requests]) {
      expect(request.usage.cacheRead).toBeGreaterThan(3000);
      expect(request.usage.input).toBe(0);
    }
    expect(sum(one.requests).cost).toBeLessThan(BEFORE.one.cost / 2);
    expect(sum(two.requests).cost).toBeLessThan(BEFORE.two.cost / 2);

    // What the page says the conversation cost is what the provider billed.
    const shown = two.outcome.conversation.usage;
    const all = [...one.requests, ...two.requests];
    expect(shown.requests).toBe(all.length);
    expect(shown.cost).toBeCloseTo(sum(all).cost, 6);
    expect(shown.input + shown.output).toBe(sum(all).tokens);
    expect(shown.question.cost).toBeCloseTo(sum(two.requests).cost, 6);
  });

  it('the same two questions with the narrow tools cost a few cents each, under the ceiling', async () => {
    const running = await started();
    const meter = new Meter();
    const one = await ask(running, meter, QUESTION_ONE, NARROW_ONE);
    const two = await ask(
      running,
      meter,
      QUESTION_TWO,
      NARROW_TWO,
      one.outcome.conversation.conversationId
    );
    write('the same two questions with the narrow tools', [
      report('question 1', one.requests),
      report('question 2', two.requests),
      `shown at the end: ${JSON.stringify(two.outcome.conversation.usage)}`,
    ]);
    expect(one.held ?? two.held).toBeUndefined();
    expect(one.requests).toHaveLength(NARROW_ONE.length);
    expect(two.requests).toHaveLength(NARROW_TWO.length);
    expect(one.outcome.conversation.entries.at(-1)).toMatchObject({ kind: 'assistant' });
    // The proposal was really made: the scripted tools ran on the rig.
    expect(
      two.outcome.conversation.entries.filter((e) => e.kind === 'tool').map((e) => e.ok)
    ).toEqual([true, true, true, true, true]);

    const first = sum(one.requests);
    const second = sum(two.requests);
    expect(first.cost).toBeLessThan(0.06);
    expect(second.cost).toBeLessThan(0.1);
    expect(first.tokens).toBeLessThan(BEFORE.one.tokens / 5);
    expect(second.tokens).toBeLessThan(BEFORE.two.tokens / 3);
    for (const preview of [...one.previews, ...two.previews]) {
      expect(preview.ceiling).toBe(0.25);
    }
  });

  it('what is shown before a request is sent is what reading it costs, with the cache as it is', async () => {
    const running = await started();
    await running.invoke('ai-assist:setQuestionCeiling', { dollars: 0 });
    const meter = new Meter();
    const one = await ask(running, meter, QUESTION_ONE, WIDE_ONE);
    for (const request of one.requests) {
      const real = readCost(request.usage);
      expect(request.estimate).not.toBeNull();
      // Within a tenth of what the provider then billed for reading it.
      expect(Math.abs((request.estimate ?? 0) - real)).toBeLessThan(real * 0.1 + 0.0005);
    }
    // Each preview says what the question has cost so far: the sum of what was billed.
    let spent = 0;
    one.previews.forEach((preview, i) => {
      expect(preview.round).toBe(i + 1);
      expect(preview.spent).toBeCloseTo(spent, 6);
      spent += one.requests[i]?.cost ?? 0;
    });
  });

  it('a question that reads on and on stops at the ceiling and asks, before it is passed', async () => {
    const running = await started();
    await running.invoke('ai-assist:setQuestionCeiling', { dollars: 0.05 });
    const meter = new Meter();
    const one = await ask(running, meter, QUESTION_ONE, WIDE_ONE);
    write('the first question as it went, with a ceiling of $0.05', [
      report('question 1', one.requests),
      `held back: request ${one.held?.round}, spent $${(one.held?.spent ?? 0).toFixed(4)}`,
    ]);
    expect(one.held).toBeDefined();
    expect(one.requests.length).toBeLessThan(WIDE_ONE.length);
    expect(one.held).toMatchObject({ overCeiling: true, ceiling: 0.05 });
    // Stopped before the ceiling was passed by more than one request's worth.
    const spent = sum(one.requests).cost;
    expect(one.held?.spent).toBeCloseTo(spent, 6);
    const last = one.requests.at(-1)?.cost ?? 0;
    expect(spent - last).toBeLessThan(0.05);
    // Nothing goes until the user says so.
    const sent = running.ports.http.calls.length;
    await expect(
      running.invoke('ai-assist:assistantSend', { requestId: one.held?.requestId })
    ).rejects.toThrow(/ai\.ceiling/);
    expect(running.ports.http.calls).toHaveLength(sent);
  });
});
