import type { z } from 'zod';
import type { Logger } from '../logger';
import type { Ports } from '../ports';
import type { CheckGroup, CheckItem } from '../profile/schema';
import type { Result } from '../result';

export interface CheckContext {
  ports: Ports;
  log: Logger;
}

export interface CheckOutcome {
  pass: boolean;
  /** One line: what is true right now. */
  summary: string;
  /** Extra lines, e.g. one per difference. */
  details?: string[];
}

export interface CheckDefinition<P = unknown> {
  /** Namespaced by feature, e.g. "device.connected". */
  type: string;
  group: CheckGroup;
  label: string;
  params: z.ZodType<P>;
  run(params: P, ctx: CheckContext): Promise<CheckOutcome>;
  /**
   * Optional: what Stand down does for an item of this type. Resolves with a message
   * describing what was done, or null when there was nothing to do.
   */
  standDown?(params: P, ctx: CheckContext): Promise<Result<string | null>>;
}

export interface RemediationDefinition<P = unknown> {
  /** Namespaced by feature, e.g. "process.launch". */
  type: string;
  label: string;
  /** Make ready runs fixes in ascending order: apps 100, displays 200, files 300. */
  order: number;
  params: z.ZodType<P>;
  /** What the fix will do, shown next to the failing check. */
  describe(params: P): string;
  /** Resolves with a message describing what was done. */
  run(params: P, ctx: CheckContext): Promise<Result<string>>;
}

/** A check proposed from the current state of the machine. */
export interface CaptureCandidate {
  /** Stable within one capture run. */
  key: string;
  group: CheckGroup;
  title: string;
  description?: string;
  selectedByDefault: boolean;
  check: Omit<CheckItem, 'id'>;
}

export interface CaptureDefinition {
  id: string;
  label: string;
  capture(ctx: CheckContext): Promise<Result<CaptureCandidate[]>>;
}

/**
 * Check, remediation and capture types are registered by features. There is no
 * central switch statement to edit.
 */
export class CheckRegistry {
  private checks = new Map<string, CheckDefinition>();
  private remediations = new Map<string, RemediationDefinition>();
  private captures = new Map<string, CaptureDefinition>();

  registerCheck<P>(definition: CheckDefinition<P>): void {
    if (this.checks.has(definition.type)) {
      throw new Error(`Check type registered twice: ${definition.type}`);
    }
    this.checks.set(definition.type, definition as CheckDefinition);
  }

  registerRemediation<P>(definition: RemediationDefinition<P>): void {
    if (this.remediations.has(definition.type)) {
      throw new Error(`Remediation type registered twice: ${definition.type}`);
    }
    this.remediations.set(definition.type, definition as RemediationDefinition);
  }

  registerCapture(definition: CaptureDefinition): void {
    if (this.captures.has(definition.id)) {
      throw new Error(`Capture registered twice: ${definition.id}`);
    }
    this.captures.set(definition.id, definition);
  }

  check(type: string): CheckDefinition | undefined {
    return this.checks.get(type);
  }

  remediation(type: string): RemediationDefinition | undefined {
    return this.remediations.get(type);
  }

  allCaptures(): CaptureDefinition[] {
    return [...this.captures.values()];
  }

  checkTypes(): string[] {
    return [...this.checks.keys()].sort();
  }

  remediationTypes(): string[] {
    return [...this.remediations.keys()].sort();
  }
}
