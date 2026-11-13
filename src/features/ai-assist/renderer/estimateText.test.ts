import { describe, expect, it } from 'vitest';
import type { MonthBudget, Price } from '../core/model';
import {
  ACKNOWLEDGE_TICK,
  acknowledgedLine,
  acknowledgeLines,
  acknowledgeTitle,
  budgetHint,
  ESTIMATE_NOTE,
  estimated,
  monthLine,
  monthSoFar,
  monthWarning,
  NOT_A_BILL,
  parsePrice,
  parsePrices,
  priceList,
  pricesHint,
  pricesName,
  priceText,
  resetLabel,
} from './estimateText';

const OPUS: Price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
const OWN: Price = { input: 8, output: 40, cacheRead: 0.4, cacheWrite: 10 };
const builtIn = {
  prices: { source: 'built-in', ...OPUS },
  builtInPrices: OPUS,
  pricesRecorded: 'November 2026',
} as const;
const own = { ...builtIn, prices: { source: 'own', ...OWN } } as const;
const none = { prices: null, builtInPrices: null, pricesRecorded: 'November 2026' };

function month(over: Partial<MonthBudget> = {}): MonthBudget {
  return {
    budget: 5,
    month: '2026-11',
    spent: 1.234,
    requests: 7,
    unpriced: 0,
    state: 'ok',
    ...over,
  };
}

describe('ASSIST-008 a dollar figure is worded as an estimate that names its prices', () => {
  it("names the prices behind an estimate: built-in as of the month they were recorded, the user's own, or both", () => {
    expect(pricesName('built-in')).toBe('built-in prices of November 2026');
    expect(pricesName('own')).toBe('your own prices');
    expect(pricesName('mixed')).toBe('built-in prices of November 2026 and your own prices');
    expect(estimated(0.3349, 'built-in')).toBe(
      'estimated $0.33 at built-in prices of November 2026'
    );
    expect(estimated(0.004, 'own')).toBe('estimated less than $0.01 at your own prices');
    expect(estimated(0.02, 'own', 'to read')).toBe('estimated $0.02 to read at your own prices');
    expect(estimated(1.5, 'mixed')).toBe(
      'estimated $1.50 at built-in prices of November 2026 and your own prices'
    );
  });

  it('shows no figure without prices, and none whose prices it cannot name', () => {
    expect(estimated(null, null)).toBe('');
    expect(estimated(null, 'built-in')).toBe('');
    expect(estimated(0.33, null)).toBe('');
  });

  it('never words a figure as a cost or a bill', () => {
    const lines = [
      estimated(0.33, 'built-in'),
      estimated(0.33, 'own', 'to read'),
      monthSoFar(month()),
      monthLine(month({ state: 'warn' })),
      monthLine(month({ state: 'stopped', spent: 5 })),
      monthWarning(month({ state: 'warn' })),
    ];
    for (const line of lines) {
      expect(line, line).toMatch(/\$\d/);
      expect(line, line).toMatch(/estimate/);
      expect(line, line).not.toMatch(/\bcosts?\b/i);
      expect(line.replace('not on a bill', ''), line).not.toMatch(/\bbill/);
    }
  });

  it('says that estimates are not a bill, where the true figure is, and to set a limit at the provider', () => {
    expect(NOT_A_BILL).toBe(
      "Estimates, not a bill: your provider's console shows what you are charged."
    );
    expect(ESTIMATE_NOTE).toMatch(/Every dollar figure RigReady shows is an estimate/);
    expect(ESTIMATE_NOTE).toMatch(
      /the token counts come from your provider, the prices from this row/
    );
    expect(ESTIMATE_NOTE).toMatch(/It is not a bill\./);
    expect(ESTIMATE_NOTE).toMatch(/Your provider's console shows what you are charged/);
    expect(ESTIMATE_NOTE).toMatch(
      /a spending limit set there is the one that holds, so set one there/
    );
  });
});

describe('ASSIST-009 prices as they are typed and shown in Settings', () => {
  it('reads a typed price per million tokens, 0 included, and nothing that is not one', () => {
    expect(parsePrice('4')).toBe(4);
    expect(parsePrice(' $0.20 ')).toBe(0.2);
    expect(parsePrice('2,5')).toBe(2.5);
    expect(parsePrice('.05')).toBe(0.05);
    expect(parsePrice('0')).toBe(0);
    expect(parsePrice('10000')).toBe(10_000);
    for (const text of ['', ' ', 'four', '-1', '1e3', '10001', '0.2.5', '$']) {
      expect(parsePrice(text), text).toBeUndefined();
    }
    expect(parsePrices({ input: '8', output: '40', cacheRead: '0.4', cacheWrite: '10' })).toEqual(
      OWN
    );
    // One field that is not a price, and there are no prices to save.
    expect(
      parsePrices({ input: '8', output: '', cacheRead: '0.4', cacheWrite: '10' })
    ).toBeUndefined();
    expect(
      parsePrices({ input: '8', output: '40', cacheRead: '0.4', cacheWrite: 'free' })
    ).toBeUndefined();
  });

  it('shows a price as it would be typed', () => {
    expect(priceText(4)).toBe('4');
    expect(priceText(0.2)).toBe('0.2');
    expect(priceText(2.5)).toBe('2.5');
    expect(priceText(0.123457)).toBe('0.123457');
    expect(priceText(0)).toBe('0');
    expect(priceList(OPUS)).toBe('$4 in, $20 out, $0.2 cache read, $5 cache write');
  });

  it('says where the prices in the fields come from, with the month the built-in ones were recorded', () => {
    expect(pricesHint(builtIn)).toBe(
      "RigReady's built-in prices for this model, recorded in November 2026. Providers change their prices: compare these with your provider's price list, and type your own where they differ."
    );
    expect(pricesHint(own)).toBe(
      "Your own prices. RigReady's built-in prices for this model, recorded in November 2026, are $4 in, $20 out, $0.2 cache read, $5 cache write."
    );
    expect(pricesHint({ ...own, builtInPrices: null })).toBe(
      'Your own prices. RigReady has no built-in prices for this model.'
    );
    expect(pricesHint(none)).toBe(
      "RigReady has no prices for this model, so it shows no dollar figure for it and neither limit below applies. Type the prices from your provider's price list to get estimates."
    );
  });

  it("offers a reset only for the user's own prices, and says what it goes back to", () => {
    expect(resetLabel(builtIn)).toBe('');
    expect(resetLabel(none)).toBe('');
    expect(resetLabel(own)).toBe('Reset to built-in');
    expect(resetLabel({ ...own, builtInPrices: null })).toBe('Remove my prices');
  });
});

describe('ASSIST-007 the month against its budget, in words', () => {
  it('says what the month is estimated at, over how many requests, and what had no prices', () => {
    expect(monthSoFar(month())).toBe(
      'This month so far: estimated $1.23 over 7 requests, at the prices in force when each was sent.'
    );
    expect(monthSoFar(month({ spent: 0.004, requests: 1, unpriced: 1 }))).toBe(
      'This month so far: estimated less than $0.01 over 1 request, at the prices in force when each was sent. 1 request had no prices and is in no estimate.'
    );
    expect(monthSoFar(month({ spent: 0, requests: 0 }))).toBe(
      'This month so far: nothing is estimated yet.'
    );
    expect(monthSoFar(month({ spent: 0, requests: 0, unpriced: 3 }))).toBe(
      'This month so far: nothing is estimated yet. 3 requests had no prices and are in no estimate.'
    );
  });

  it('warns from 80 percent, and says when it stopped that it stopped on the estimate', () => {
    expect(monthLine(month())).toBe(monthSoFar(month()));
    expect(monthLine(month({ spent: 4.2, state: 'warn' }))).toBe(
      'This month so far: estimated $4.20 over 7 requests, at the prices in force when each was sent. That is 80 percent or more of your monthly budget of $5.00.'
    );
    expect(monthLine(month({ spent: 5.01, state: 'stopped' }))).toBe(
      'This month so far: estimated $5.01 over 7 requests, at the prices in force when each was sent. That reaches your monthly budget of $5.00: RigReady sends nothing more this month. It stopped on its estimate, not on a bill.'
    );
    // A count that cannot be read stops everything while a budget is set, and says why.
    expect(
      monthLine(
        month({ spent: 0, requests: 0, state: 'stopped', problem: 'spend.json is not valid JSON.' })
      )
    ).toBe(
      "RigReady could not read its count of this month's estimates: spend.json is not valid JSON. With a monthly budget set, RigReady sends nothing it cannot count."
    );
  });

  it('says in the request that waits when the month is close to its budget, and nothing before', () => {
    expect(monthWarning(null)).toBe('');
    expect(monthWarning(month())).toBe('');
    expect(monthWarning(month({ budget: 0, state: 'off' }))).toBe('');
    expect(monthWarning(month({ spent: 4.2, state: 'warn' }))).toBe(
      'Close to your monthly budget: this month is estimated at $4.20 of $5.00 so far, at the prices in force when each request was sent, and this request comes on top. RigReady sends nothing more once the estimate reaches the budget.'
    );
  });

  it('says in Settings what the budget does, and when it does nothing', () => {
    expect(budgetHint({ priceKnown: true, month: month({ budget: 0, state: 'off' }) })).toBe(
      'Off. With an amount set, RigReady warns from 80 percent of this amount, then sends nothing more until the next calendar month, or until you raise the amount or turn it off. 0 means no monthly budget.'
    );
    expect(budgetHint({ priceKnown: true, month: month() })).toBe(
      "RigReady warns from 80 percent of this amount, then sends nothing more until the next calendar month, or until you raise the amount or turn it off. It works on RigReady's estimates, not on your provider's bill. 0 means no monthly budget."
    );
    expect(budgetHint({ priceKnown: false, month: month() })).toBe(
      'No prices are set for this model, so nothing is estimated and this amount is not used.'
    );
  });
});

describe('ASSIST-010 what is acknowledged before a limit is turned on', () => {
  it('says the limit is counted from estimates at the prices in Settings, is not the bill, and that the hard limit belongs at the provider', () => {
    const lines = acknowledgeLines('questionCeiling', builtIn);
    expect(lines).toEqual([
      "RigReady counts this limit from its own estimates: the token counts your provider reports, at the prices shown in Settings. Right now those are RigReady's built-in prices, recorded in November 2026.",
      "It is not your provider's bill. Prices change, and what you are charged can be more than what RigReady estimates.",
      "The limit that holds is the one at your provider. Set a spending limit in your provider's console as well.",
    ]);
    expect(acknowledgeLines('questionCeiling', own)[0]).toMatch(
      /Right now those are your own prices\.$/
    );
    // The month also says what it does not count.
    const monthly = acknowledgeLines('monthlyBudget', builtIn);
    expect(monthly.slice(0, 3)).toEqual(lines);
    expect(monthly[3]).toBe(
      'A request you stop, a request that fails on its way, and a request to a model without prices are in no estimate, though your provider may charge for them.'
    );
    expect(ACKNOWLEDGE_TICK).toBe(
      "I understand that this limit works on RigReady's estimates, not on my provider's bill."
    );
    expect(acknowledgeTitle('monthlyBudget', 5)).toBe('Turn on a monthly budget of $5.00');
    expect(acknowledgeTitle('questionCeiling', 0.5)).toBe(
      'Ask before the estimate for one question passes $0.50'
    );
  });

  it('says when it was acknowledged, from the time that was stored', () => {
    expect(acknowledgedLine('2026-11-12T12:00:00.000Z')).toBe(
      'You acknowledged on 12 November 2026 that this limit works on estimates.'
    );
    expect(acknowledgedLine(undefined)).toBe('');
    expect(acknowledgedLine('not a time')).toBe('');
  });
});
