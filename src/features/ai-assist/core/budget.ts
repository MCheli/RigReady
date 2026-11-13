import { z } from 'zod';
import { JsonStore } from '../../../core/jsonStore';
import type { Logger } from '../../../core/logger';
import type { Clock, FileStore } from '../../../core/ports';
import { BUDGET_WARN_SHARE, type MonthBudget } from './model';

/**
 * The monthly budget: a count of what RigReady estimates the month's answered requests at,
 * and the rule that warns and then stops sending.
 *
 * Everything here is an estimate. The provider reports exact token counts; the dollars come
 * from prices kept in the app (the built-in table, or the user's own numbers), each request
 * at the prices in force when it was sent. What the provider charges is in its console, and
 * the limit that holds is the one set there. A request the user stops, or one that fails on
 * its way, is not counted, though the provider may still charge for it.
 */

const SpendSchema = z.object({
  /** The calendar month counted, by this PC's clock: "2026-11". Empty before the first request. */
  month: z.string().default(''),
  /** The estimate in US dollars of that month's answered requests that had prices. */
  estimated: z.number().min(0).default(0),
  /** How many requests are in the estimate. */
  requests: z.number().int().min(0).default(0),
  /** Answered requests of that month that had no prices: in no estimate. */
  unpriced: z.number().int().min(0).default(0),
});
type Spend = z.infer<typeof SpendSchema>;

/** The calendar month a moment falls in, by this PC's clock: "2026-11". */
export function monthKey(at: Date): string {
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Where a month stands against its budget once a request estimated at `next` dollars is
 * counted in: stopped when the estimate has reached the budget or the request would take it
 * past, warning from the warning share on. What a request is estimated at before it is sent
 * is the reading of it, so the answer to the last request can take a month a little past.
 */
export function budgetState(budget: number, spent: number, next = 0): MonthBudget['state'] {
  if (budget <= 0) return 'off';
  if (spent >= budget || spent + next > budget) return 'stopped';
  return spent + next >= budget * BUDGET_WARN_SHARE ? 'warn' : 'ok';
}

const dollars = (amount: number): string => `$${amount.toFixed(2)}`;

/** What is said when the monthly budget holds a request back. It stopped on an estimate, and says so. */
export function budgetStopMessage(month: MonthBudget): string {
  const settings = 'You can raise the budget or turn it off in Settings under AI.';
  if (month.problem !== undefined) {
    return `RigReady could not read its count of this month's estimates, and with a monthly budget set it sends nothing it cannot count: ${month.problem} Nothing was sent. ${settings}`;
  }
  const reached =
    month.spent >= month.budget
      ? `this month's requests are estimated at ${dollars(month.spent)}, which reaches your monthly budget of ${dollars(month.budget)}`
      : `this month's requests are estimated at ${dollars(month.spent)}, and this one would take the estimate past your monthly budget of ${dollars(month.budget)}`;
  return `Stopped on RigReady's estimate, not on a bill: ${reached}. Nothing was sent. ${settings} What you are charged is in your provider's console.`;
}

/** The month's estimate, kept in one file under RigReady's data folder. */
export class MonthSpend {
  private readonly store: JsonStore<typeof SpendSchema>;

  constructor(
    files: FileStore,
    file: string,
    private readonly clock: Clock,
    private readonly log: Logger
  ) {
    this.store = new JsonStore(files, file, SpendSchema);
  }

  private fresh(month: string): Spend {
    return { month, estimated: 0, requests: 0, unpriced: 0 };
  }

  /**
   * This month against `budget`, as it would stand with a request estimated at `next`
   * dollars counted in. A count that cannot be read stops everything while a budget is set:
   * a budget that let requests through uncounted would not be one.
   */
  async view(budget: number, next = 0): Promise<MonthBudget> {
    const month = monthKey(this.clock.now());
    const read = await this.store.read();
    if (!read.ok) {
      return {
        budget,
        month,
        spent: 0,
        requests: 0,
        unpriced: 0,
        state: budget > 0 ? 'stopped' : 'off',
        problem: read.error.message,
      };
    }
    // A new month starts from nothing.
    const kept = read.value.month === month ? read.value : this.fresh(month);
    return {
      budget,
      month,
      spent: kept.estimated,
      requests: kept.requests,
      unpriced: kept.unpriced,
      state: budgetState(budget, kept.estimated, next),
    };
  }

  /**
   * Counts one answered request: what it is estimated at, or (null) that it had no prices.
   * The answer is already here, so a count that cannot be written is logged and never fails it.
   */
  async record(estimate: number | null): Promise<void> {
    const month = monthKey(this.clock.now());
    const saved = await this.store.update((spend) => {
      const kept = spend.month === month ? spend : this.fresh(month);
      return estimate === null
        ? { ...kept, unpriced: kept.unpriced + 1 }
        : { ...kept, estimated: kept.estimated + estimate, requests: kept.requests + 1 };
    });
    if (!saved.ok) {
      this.log.warn("ai-assist: a request could not be counted in the month's estimate", {
        failure: saved.error.code,
      });
    }
  }
}
