import { createRedactor } from './logger';

/**
 * Errors nobody expected (an exception that reached the top of main or of the window, a
 * helper process that died). Expected failures travel as Result values and are shown by
 * the screen that asked; these are collected here so they are logged and shown in a
 * notice instead of vanishing into a console nobody has open.
 */

export type ErrorSource = 'main' | 'window' | 'process';

export interface ErrorReport {
  id: string;
  /** ISO time of the first occurrence. */
  time: string;
  source: ErrorSource;
  /** One line. */
  message: string;
  /** The stack or whatever else helps a developer. */
  detail?: string;
  /** How often the same error has happened. */
  count: number;
}

const MAX_KEPT = 50;

/** One line and an optional stack from whatever was thrown. */
export function describeThrown(thrown: unknown): { message: string; detail?: string } {
  if (thrown instanceof Error) {
    const message = thrown.message || thrown.name || 'Error';
    return thrown.stack && thrown.stack !== message
      ? { message, detail: thrown.stack }
      : { message };
  }
  if (typeof thrown === 'string') return { message: thrown || 'Error' };
  try {
    return { message: JSON.stringify(thrown) ?? String(thrown) };
  } catch {
    // Not writable as JSON (a cycle): its text form is all there is.
    return { message: String(thrown) };
  }
}

export class ErrorCenter {
  private reports: ErrorReport[] = [];
  private pending = new Set<string>();
  private listeners = new Set<(report: ErrorReport) => void>();
  private sequence = 0;
  private readonly redact = createRedactor();

  constructor(private now: () => Date = () => new Date()) {}

  /** Records an error and tells the listeners. The same error again only counts up. */
  report(source: ErrorSource, thrown: unknown, extraDetail?: string): ErrorReport {
    const described = describeThrown(thrown);
    const message = this.redact(described.message).slice(0, 500);
    const detailText = [described.detail, extraDetail].filter(Boolean).join('\n');
    const detail = detailText ? this.redact(detailText).slice(0, 8000) : undefined;
    let report = this.reports.find((r) => r.source === source && r.message === message);
    if (report) {
      report.count++;
    } else {
      report = {
        id: `e${++this.sequence}`,
        time: this.now().toISOString(),
        source,
        message,
        ...(detail ? { detail } : {}),
        count: 1,
      };
      this.reports.push(report);
      if (this.reports.length > MAX_KEPT) {
        for (const gone of this.reports.splice(0, this.reports.length - MAX_KEPT)) {
          this.pending.delete(gone.id);
        }
      }
    }
    this.pending.add(report.id);
    const copy = { ...report };
    for (const listener of [...this.listeners]) {
      try {
        listener(copy);
      } catch {
        // A listener that fails while an error is being reported must not hide that error.
      }
    }
    return copy;
  }

  /** Every report of this run, oldest first. */
  all(): ErrorReport[] {
    return this.reports.map((r) => ({ ...r }));
  }

  /** Reports the user has not dismissed yet, oldest first. */
  unseen(): ErrorReport[] {
    return this.reports.filter((r) => this.pending.has(r.id)).map((r) => ({ ...r }));
  }

  get(id: string): ErrorReport | undefined {
    const report = this.reports.find((r) => r.id === id);
    return report ? { ...report } : undefined;
  }

  dismiss(ids?: string[]): void {
    if (!ids) this.pending.clear();
    else for (const id of ids) this.pending.delete(id);
  }

  /** Called for every report from now on. Returns the unsubscribe function. */
  subscribe(listener: (report: ErrorReport) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Forgets everything (tests). */
  reset(now?: () => Date): void {
    this.reports = [];
    this.pending.clear();
    this.listeners.clear();
    this.sequence = 0;
    if (now) this.now = now;
  }
}

/** The app's one error center: the shell reports into it, the Diagnostics feature shows it. */
export const appErrors = new ErrorCenter();

/** What "Copy details" puts on the clipboard for one report. */
export function errorDetails(report: ErrorReport, app: { version: string; os: string }): string {
  return [
    `RigReady ${app.version} on ${app.os}`,
    `${report.time} unexpected error in ${report.source}${report.count > 1 ? ` (${report.count} times)` : ''}`,
    report.message,
    ...(report.detail ? ['', report.detail] : []),
  ].join('\n');
}
