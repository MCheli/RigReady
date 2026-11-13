import {
  BUDGET_WARN_SHARE,
  MAX_PRICE,
  PRICES_RECORDED,
  type AiStatus,
  type MonthBudget,
  type Price,
  type PriceSource,
} from '../core/model';

/**
 * How a dollar figure is worded, everywhere in this feature. The provider reports token
 * counts exactly; the dollars are worked out from prices kept in the app, which may be out of
 * date. So every figure is called an estimate and names the prices behind it: the built-in
 * ones as of the month they were recorded, or the user's own. A figure is never called a cost
 * or a bill, and where there are no prices no figure is shown at all.
 */

const n = (v: number): string => v.toLocaleString('en-US');

/** A count with its noun: "1 request", "2 requests". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${n(count)} ${count === 1 ? one : many}`;
}

/** A plain amount: "$0.25". */
export function dollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** The amount of an estimate. Something is never shown as nothing: "$0.33", "less than $0.01". */
export function amountOf(amount: number): string {
  if (amount === 0) return '$0.00';
  return amount < 0.01 ? 'less than $0.01' : dollars(amount);
}

/** Which prices an estimate was worked out from, as the end of a sentence part. */
export function pricesName(source: PriceSource): string {
  if (source === 'own') return 'your own prices';
  if (source === 'mixed') return `built-in prices of ${PRICES_RECORDED} and your own prices`;
  return `built-in prices of ${PRICES_RECORDED}`;
}

/**
 * A dollar figure as what it is: "estimated $0.33 at built-in prices of November 2026".
 * `doing` goes between the amount and the prices: "estimated $0.02 to read at your own prices".
 * Empty without an amount or without the source of its prices: no figure is shown then.
 */
export function estimated(
  amount: number | null,
  source: PriceSource | null,
  doing?: string
): string {
  if (amount === null || source === null) return '';
  return `estimated ${amountOf(amount)}${doing ? ` ${doing}` : ''} at ${pricesName(source)}`;
}

/** Said once wherever estimates are on show. */
export const NOT_A_BILL =
  "Estimates, not a bill: your provider's console shows what you are charged.";

/** The longer form, for Settings: what an estimate is made of and where the true figure is. */
export const ESTIMATE_NOTE =
  "Every dollar figure RigReady shows is an estimate: the token counts come from your provider, the prices from this row. It is not a bill. Your provider's console shows what you are charged, and a spending limit set there is the one that holds, so set one there.";

/** The four prices of a model, in the order they are typed. */
export const PRICE_FIELDS = [
  { key: 'input', label: 'Input' },
  { key: 'output', label: 'Output' },
  { key: 'cacheRead', label: 'Cache read' },
  { key: 'cacheWrite', label: 'Cache write' },
] as const;

export type PriceKey = (typeof PRICE_FIELDS)[number]['key'];

/** A price per million tokens as it is typed and shown: "4", "0.2", "2.5". */
export function priceText(price: number): string {
  return String(Number(price.toFixed(6)));
}

/** A typed price in dollars per million tokens: 0 to 10,000, and 0 is a price. Anything else is none. */
export function parsePrice(text: string): number | undefined {
  const typed = text
    .trim()
    .replace(/^\$\s*/, '')
    .replace(',', '.');
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(typed)) return undefined;
  const price = Number(typed);
  return price <= MAX_PRICE ? price : undefined;
}

/** Four typed prices as one, or nothing when any of them is not a price. */
export function parsePrices(typed: Record<PriceKey, string>): Price | undefined {
  const input = parsePrice(typed.input);
  const output = parsePrice(typed.output);
  const cacheRead = parsePrice(typed.cacheRead);
  const cacheWrite = parsePrice(typed.cacheWrite);
  if (
    input === undefined ||
    output === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined
  ) {
    return undefined;
  }
  return { input, output, cacheRead, cacheWrite };
}

/** A model's prices in one line: "$4 in, $20 out, $0.2 cache read, $5 cache write". */
export function priceList(price: Price): string {
  return `$${priceText(price.input)} in, $${priceText(price.output)} out, $${priceText(price.cacheRead)} cache read, $${priceText(price.cacheWrite)} cache write`;
}

type PriceStatus = Pick<AiStatus, 'prices' | 'builtInPrices' | 'pricesRecorded'>;

/** In Settings: where the prices in the four fields come from, and what to do about them. */
export function pricesHint(status: PriceStatus): string {
  const builtIn = status.builtInPrices;
  if (status.prices === null) {
    return "RigReady has no prices for this model, so it shows no dollar figure for it and neither limit below applies. Type the prices from your provider's price list to get estimates.";
  }
  if (status.prices.source === 'own') {
    return builtIn
      ? `Your own prices. RigReady's built-in prices for this model, recorded in ${status.pricesRecorded}, are ${priceList(builtIn)}.`
      : 'Your own prices. RigReady has no built-in prices for this model.';
  }
  return `RigReady's built-in prices for this model, recorded in ${status.pricesRecorded}. Providers change their prices: compare these with your provider's price list, and type your own where they differ.`;
}

/** In Settings: what resetting the prices does, as the button says it. Empty when there is nothing to reset. */
export function resetLabel(status: PriceStatus): string {
  if (status.prices?.source !== 'own') return '';
  return status.builtInPrices ? 'Reset to built-in' : 'Remove my prices';
}

const percent = Math.round(BUDGET_WARN_SHARE * 100);

/**
 * What RigReady estimates this calendar month at so far. A month is a sum over requests that
 * may have been estimated at different prices, and says so.
 */
export function monthSoFar(month: MonthBudget): string {
  if (month.problem !== undefined) {
    return `RigReady could not read its count of this month's estimates: ${month.problem}`;
  }
  const unpriced =
    month.unpriced > 0
      ? ` ${plural(month.unpriced, 'request')} had no prices and ${month.unpriced === 1 ? 'is' : 'are'} in no estimate.`
      : '';
  if (month.requests === 0) return `This month so far: nothing is estimated yet.${unpriced}`;
  return `This month so far: estimated ${amountOf(month.spent)} over ${plural(month.requests, 'request')}, at the prices in force when each was sent.${unpriced}`;
}

/** In Settings: the month against the budget, and what state that is. */
export function monthLine(month: MonthBudget): string {
  const soFar = monthSoFar(month);
  if (month.state === 'stopped') {
    return month.problem !== undefined
      ? `${soFar} With a monthly budget set, RigReady sends nothing it cannot count.`
      : `${soFar} That reaches your monthly budget of ${dollars(month.budget)}: RigReady sends nothing more this month. It stopped on its estimate, not on a bill.`;
  }
  if (month.state === 'warn') {
    return `${soFar} That is ${percent} percent or more of your monthly budget of ${dollars(month.budget)}.`;
  }
  return soFar;
}

/** In the request that waits: said only when the month is close to its budget. */
export function monthWarning(month: MonthBudget | null): string {
  if (month?.state !== 'warn') return '';
  return `Close to your monthly budget: this month is estimated at ${amountOf(month.spent)} of ${dollars(month.budget)} so far, at the prices in force when each request was sent, and this request comes on top. RigReady sends nothing more once the estimate reaches the budget.`;
}

/** In Settings: what the monthly budget does, and when it does nothing. */
export function budgetHint(status: Pick<AiStatus, 'priceKnown' | 'month'>): string {
  if (!status.priceKnown) {
    return 'No prices are set for this model, so nothing is estimated and this amount is not used.';
  }
  const rule = `RigReady warns from ${percent} percent of this amount, then sends nothing more until the next calendar month, or until you raise the amount or turn it off.`;
  if (status.month.budget === 0)
    return `Off. With an amount set, ${rule} 0 means no monthly budget.`;
  return `${rule} It works on RigReady's estimates, not on your provider's bill. 0 means no monthly budget.`;
}

export type Limit = 'questionCeiling' | 'monthlyBudget';

/** The heading of the dialog that turns a limit on. */
export function acknowledgeTitle(limit: Limit, amount: number): string {
  return limit === 'monthlyBudget'
    ? `Turn on a monthly budget of ${dollars(amount)}`
    : `Ask before the estimate for one question passes ${dollars(amount)}`;
}

/** What the user is told, and ticks, before a limit is turned on. */
export function acknowledgeLines(limit: Limit, status: PriceStatus): string[] {
  const now =
    status.prices?.source === 'own'
      ? 'your own prices'
      : `RigReady's built-in prices, recorded in ${status.pricesRecorded}`;
  return [
    `RigReady counts this limit from its own estimates: the token counts your provider reports, at the prices shown in Settings. Right now those are ${now}.`,
    "It is not your provider's bill. Prices change, and what you are charged can be more than what RigReady estimates.",
    "The limit that holds is the one at your provider. Set a spending limit in your provider's console as well.",
    ...(limit === 'monthlyBudget'
      ? [
          'A request you stop, a request that fails on its way, and a request to a model without prices are in no estimate, though your provider may charge for them.',
        ]
      : []),
  ];
}

/** What the tick in that dialog says. */
export const ACKNOWLEDGE_TICK =
  "I understand that this limit works on RigReady's estimates, not on my provider's bill.";

/** When a limit was acknowledged, from the time that was stored; empty when it was not. */
export function acknowledgedLine(at: string | undefined): string {
  if (at === undefined) return '';
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return '';
  const day = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `You acknowledged on ${day} that this limit works on estimates.`;
}
