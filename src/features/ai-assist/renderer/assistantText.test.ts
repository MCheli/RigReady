import { describe, expect, it } from 'vitest';
import {
  TurnPreviewSchema,
  type Drafts,
  type Entry,
  type TurnPreview,
} from '../core/assistantModel';
import {
  budgetLine,
  ceilingHint,
  flow,
  PANEL_WIDTH,
  panelWidth,
  parseDollars,
  plural,
  sizeLine,
  spendLine,
  usageLine,
  workingLine,
} from './assistantText';
import { amountOf } from './estimateText';

function preview(over: Partial<TurnPreview> = {}): TurnPreview {
  return TurnPreviewSchema.parse({
    requestId: 'r1',
    conversationId: 'c1',
    model: 'claude-opus-5-5',
    to: 'Anthropic',
    local: false,
    body: '{}',
    chars: 18_004,
    approxTokens: 4445,
    approxCost: 0.0222,
    prices: 'built-in',
    contents: [],
    round: 1,
    spent: 0,
    ceiling: 0.25,
    overCeiling: false,
    ...over,
  });
}

describe('ASSIST-001 the numbers the assistant panel shows', () => {
  it('counts in the right number', () => {
    expect(plural(1, 'setup')).toBe('1 setup');
    expect(plural(0, 'setup')).toBe('0 setups');
    expect(plural(8, 'hit')).toBe('8 hits');
    expect(plural(1, 'entry', 'entries')).toBe('1 entry');
    expect(plural(2, 'entry', 'entries')).toBe('2 entries');
    expect(plural(100_090, 'token')).toBe('100,090 tokens');
  });

  it('never shows a cost as nothing, and never as a cent when it is thirty', () => {
    expect(amountOf(0.0004)).toBe('less than $0.01');
    expect(amountOf(0.0099)).toBe('less than $0.01');
    expect(amountOf(0.01)).toBe('$0.01');
    expect(amountOf(0.3349)).toBe('$0.33');
    expect(amountOf(12.5)).toBe('$12.50');
    // Nothing at all is nothing: a model the user typed prices of 0 for.
    expect(amountOf(0)).toBe('$0.00');
  });

  it('says which request of the question waits and that its cost is only the reading', () => {
    expect(sizeLine(preview())).toBe(
      'Request 1 of this question · about 4,445 tokens · estimated $0.02 to read at built-in prices of November 2026, plus the answer'
    );
    expect(sizeLine(preview({ round: 4, approxTokens: 1, approxCost: 0.004, prices: 'own' }))).toBe(
      'Request 4 of this question · about 1 token · estimated less than $0.01 to read at your own prices, plus the answer'
    );
    // No prices: no figure is made up.
    expect(sizeLine(preview({ approxCost: null, prices: null, spent: null, ceiling: null }))).toBe(
      'Request 1 of this question · about 4,445 tokens'
    );
    // A figure whose prices are not named is not shown either.
    expect(sizeLine(preview({ prices: null }))).toBe(
      'Request 1 of this question · about 4,445 tokens'
    );
  });

  it('says what the question has cost and where RigReady stops to ask', () => {
    expect(budgetLine(preview())).toBe(
      'RigReady asks before the estimate for a question passes $0.25.'
    );
    expect(budgetLine(preview({ round: 3, spent: 0.0438, spentPrices: 'built-in' }))).toBe(
      'This question so far: estimated $0.04 at built-in prices of November 2026. RigReady asks before the estimate for it passes $0.25.'
    );
    expect(
      budgetLine(preview({ round: 3, spent: 0.24, spentPrices: 'built-in', overCeiling: true }))
    ).toBe(
      'This question is estimated at $0.24 so far, at built-in prices of November 2026, and this request would take the estimate past $0.25, the most one question may reach before RigReady asks you.'
    );
    expect(budgetLine(preview({ ceiling: 0.01, overCeiling: true }))).toBe(
      'Reading this request alone is estimated at $0.02, at built-in prices of November 2026: more than $0.01, the most one question may reach before RigReady asks you.'
    );
    expect(budgetLine(preview({ ceiling: null }))).toBe('No ceiling is set in Settings.');
    expect(
      budgetLine(preview({ ceiling: null, spent: 0.5, spentPrices: 'built-in', round: 9 }))
    ).toBe(
      'This question so far: estimated $0.50 at built-in prices of November 2026. No ceiling is set in Settings.'
    );
    // The prices were changed in the middle of a question: what went before says so.
    expect(
      budgetLine(preview({ round: 2, spent: 0.05, spentPrices: 'mixed', prices: 'own' }))
    ).toBe(
      'This question so far: estimated $0.05 at built-in prices of November 2026 and your own prices. RigReady asks before the estimate for it passes $0.25.'
    );
    // A model without prices: said once, and nothing for a model on this PC.
    const bare = { approxCost: null, prices: null, spent: null, ceiling: null };
    expect(budgetLine(preview(bare))).toBe(
      'No prices are set for this model, so no dollar figure is shown and neither the ceiling nor the monthly budget applies. You can enter prices in Settings under AI.'
    );
    expect(budgetLine(preview({ ...bare, local: true }))).toBe('');
  });

  it('says what it is doing, with the request it is on and what the question has used', () => {
    expect(workingLine(undefined)).toBe('Sending the request');
    const asking = {
      conversationId: 'c1',
      phase: 'asking',
      round: 2,
      cost: 0.031,
      prices: 'built-in',
      tokens: 9120,
    } as const;
    expect(workingLine({ ...asking, phase: 'asking' })).toBe('Waiting for the answer (request 2)');
    expect(workingLine({ ...asking, phase: 'tool', tool: 'Find installed programs' })).toBe(
      'Running: Find installed programs (request 2)'
    );
    expect(workingLine({ ...asking, phase: 'tool' })).toBe('Running: a tool (request 2)');
    expect(spendLine({ ...asking, phase: 'asking' })).toBe(
      '9,120 tokens so far, estimated $0.03 at built-in prices of November 2026'
    );
    expect(spendLine({ ...asking, phase: 'asking', cost: null, prices: null })).toBe(
      '9,120 tokens so far'
    );
    expect(spendLine({ ...asking, phase: 'asking', tokens: 0, cost: 0, prices: null })).toBe('');
    expect(spendLine(undefined)).toBe('');
  });

  it("totals the conversation, with what was read from the provider's cache", () => {
    const question = {
      requests: 2,
      input: 9000,
      cached: 4000,
      output: 400,
      cost: 0.044,
      prices: 'built-in',
    } as const;
    expect(usageLine({ ...question, question })).toBe(
      'This conversation: 2 requests, 9,400 tokens (4,000 read from cache), estimated $0.04 at built-in prices of November 2026'
    );
    // A conversation whose requests were estimated at different prices says so.
    expect(usageLine({ ...question, prices: 'mixed', question })).toBe(
      'This conversation: 2 requests, 9,400 tokens (4,000 read from cache), estimated $0.04 at built-in prices of November 2026 and your own prices'
    );
    const one = { requests: 1, input: 900, cached: 0, output: 80, cost: null, prices: null };
    expect(usageLine({ ...one, question: one })).toBe('This conversation: 1 request, 980 tokens');
    const none = { requests: 0, input: 0, cached: 0, output: 0, cost: 0, prices: null };
    expect(usageLine({ ...none, question: none })).toBe('');
  });

  it('reads a typed amount of dollars and nothing that is not one', () => {
    expect(parseDollars('0.25')).toBe(0.25);
    expect(parseDollars(' $0.50 ')).toBe(0.5);
    expect(parseDollars('$ 2')).toBe(2);
    expect(parseDollars('0,25')).toBe(0.25);
    expect(parseDollars('.5')).toBe(0.5);
    expect(parseDollars('1.')).toBe(1);
    expect(parseDollars('0')).toBe(0);
    for (const text of ['', ' ', 'a quarter', '-1', '1e3', '0.2.5', '1 000', '$', 'NaN']) {
      expect(parseDollars(text), text).toBeUndefined();
    }
  });

  it('says in Settings what the ceiling does, and when it does nothing', () => {
    const status = { questionCeiling: 0.25, priceKnown: true, local: false };
    expect(ceilingHint(status)).toMatch(
      /Before a request would take the estimate for a question past this amount/
    );
    expect(ceilingHint(status)).toMatch(/RigReady's estimates, not on your provider's bill/);
    // A ceiling below one request holds the first one: said where the amount is typed.
    expect(ceilingHint(status)).toMatch(/holds back the first request too/);
    expect(ceilingHint({ ...status, questionCeiling: 0 })).toBe(
      'No ceiling: RigReady does not stop a question on its estimate. A question still ends when the assistant has used tools 16 times.'
    );
    expect(ceilingHint({ ...status, priceKnown: false })).toMatch(
      /^No prices are set for this model, so nothing is estimated and this amount is not used\./
    );
    expect(ceilingHint({ ...status, priceKnown: false, local: true })).toMatch(
      /^No prices are set for this server on your PC/
    );
  });

  it('keeps the panel between its narrowest and widest, with the page in sight', () => {
    expect(panelWidth(Number.NaN, 2354)).toBe(PANEL_WIDTH.fallback);
    expect(panelWidth(700, 2354)).toBe(700);
    expect(panelWidth(100, 2354)).toBe(PANEL_WIDTH.min);
    expect(panelWidth(5000, 2354)).toBe(PANEL_WIDTH.max);
    // The smallest window RigReady allows is 960 wide.
    expect(panelWidth(900, 960)).toBe(840);
    expect(panelWidth(Number.NaN, 960)).toBe(PANEL_WIDTH.fallback);
    expect(panelWidth(700.4, 2354)).toBe(700);
    expect(panelWidth(300, 400)).toBe(PANEL_WIDTH.min);
  });
});

describe('ASSIST-001 where a proposal is shown', () => {
  const tool = (title: string, draftId?: string): Entry => ({
    kind: 'tool',
    tool: 'setup_propose',
    title,
    tier: 'read',
    ok: true,
    line: 'A draft waits for you',
    ...(draftId ? { draftId } : {}),
  });
  const setup = (id: string): Drafts['setups'][number] => ({
    id,
    by: 'Built-in assistant',
    at: '2026-11-12T10:00:00.000Z',
    summary: 'Adds TrackIR',
    target: { kind: 'existing', id: 'p1', name: 'DCS F/A-18C' },
    checks: [],
    steps: [],
    exact: '{}',
  });
  const script = (id: string): Drafts['scripts'][number] => ({
    id,
    by: 'Claude Desktop',
    at: '2026-11-12T10:00:00.000Z',
    fileName: 'srs.ps1',
    stored: '{USER}\\.rigready\\scripts\\srs.ps1',
    text: 'exit 0',
    explanation: 'Checks SRS.',
    warnings: [],
    replaces: false,
  });
  const kinds = (items: { kind: string; key: string }[]): string[] => items.map((i) => i.key);

  it('puts a draft right after the tool row that made it, and what was drafted elsewhere at the end', () => {
    const entries: Entry[] = [
      { kind: 'user', text: 'Add TrackIR' },
      tool('Propose a setup', 'd1'),
      { kind: 'assistant', text: 'I proposed it.' },
    ];
    const shown = flow(entries, { setups: [setup('d1')], scripts: [script('d9')] }, {});
    expect(kinds(shown.conversation)).toEqual(['entry:0', 'entry:1', 'setup:d1', 'entry:2']);
    expect(kinds(shown.waiting)).toEqual(['script:d9']);
  });

  it('shows the line that says it was saved in the same place once the draft is saved', () => {
    const entries: Entry[] = [tool('Propose a setup', 'd1'), { kind: 'assistant', text: 'Done.' }];
    const saved = { d1: { message: 'Saved DCS F/A-18C.', setupId: 'p1' } };
    const shown = flow(entries, { setups: [], scripts: [] }, saved);
    expect(kinds(shown.conversation)).toEqual(['entry:0', 'saved:d1', 'entry:1']);
    expect(shown.waiting).toEqual([]);
  });

  it('shows a draft proposed again once, at the newest row, and nothing for one that was discarded', () => {
    const entries: Entry[] = [
      tool('Propose a setup', 'd1'),
      tool('Propose a setup', 'd1'),
      tool('Propose a setup', 'gone'),
    ];
    const shown = flow(entries, { setups: [setup('d1')], scripts: [] }, {});
    expect(kinds(shown.conversation)).toEqual(['entry:0', 'entry:1', 'setup:d1', 'entry:2']);
    expect(shown.waiting).toEqual([]);
  });

  it('keeps what was saved or approved outside this conversation in sight, once', () => {
    const saved = {
      d7: { message: 'Saved srs.ps1.' },
      'srs.ps1': { message: 'Approved srs.ps1 as it is now.' },
    };
    const shown = flow([], { setups: [setup('d7')], scripts: [] }, saved);
    // A draft that still waits wins over an older line about the same id.
    expect(kinds(shown.waiting)).toEqual(['setup:d7', 'saved:srs.ps1']);
    expect(shown.conversation).toEqual([]);
  });
});
