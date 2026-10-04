import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fixItem, makeReady, runChecks, standDown } from '../../src/core/checks/engine';
import { CheckRegistry } from '../../src/core/checks/registry';
import { CheckItemSchema, type CheckItem, type Profile } from '../../src/core/profile/schema';
import { ok } from '../../src/core/result';
import { markFull, rigFromState, type TestRig } from '../helpers';

/** A check that is switched off in the setup (CheckItem.disabled). */

let rig: TestRig;
let registry: CheckRegistry;
let truth: Record<string, boolean>;
let ran: string[];

const item = (id: string, overrides: Partial<CheckItem> = {}): CheckItem => ({
  id,
  type: 'test.flag',
  title: `Flag ${id}`,
  required: true,
  params: { flag: id },
  remediation: { type: 'test.set', params: { flag: id } },
  ...overrides,
});

const profile = (checks: CheckItem[]): Profile => ({
  schemaVersion: 1,
  id: 'p',
  name: 'P',
  createdAt: '',
  updatedAt: '',
  checks,
  extensions: {},
});

beforeEach(async () => {
  rig = await rigFromState(await markFull());
  truth = {};
  ran = [];
  registry = new CheckRegistry();
  registry.registerCheck({
    type: 'test.flag',
    group: 'apps',
    label: 'Flag',
    params: z.object({ flag: z.string() }),
    run: async (params) => {
      ran.push(`check ${params.flag}`);
      return { pass: truth[params.flag] === true, summary: truth[params.flag] ? 'On' : 'Off' };
    },
    standDown: async (params) => {
      ran.push(`standDown ${params.flag}`);
      truth[params.flag] = false;
      return ok(`Turned ${params.flag} off`);
    },
  });
  registry.registerRemediation({
    type: 'test.set',
    label: 'Set',
    order: 100,
    params: z.object({ flag: z.string() }),
    describe: (params) => `Turn ${params.flag} on`,
    run: async (params) => {
      ran.push(`fix ${params.flag}`);
      truth[params.flag] = true;
      return ok(`Turned ${params.flag} on`);
    },
  });
});
afterEach(() => rig.cleanup());

describe('a check that is switched off', () => {
  it('is not run, is reported as off, and does not count for readiness', async () => {
    const report = await runChecks(
      profile([item('a'), item('b', { disabled: true })]),
      registry,
      rig.ctx
    );
    expect(ran).toEqual(['check a']);
    expect(report.results[1]).toMatchObject({
      itemId: 'b',
      group: 'apps',
      disabled: true,
      required: false,
      summary: 'Off: not checked',
    });
    expect(report.results[1]).not.toHaveProperty('fix');
    // Flag a fails and b would too: only a counts.
    expect(report).toMatchObject({ ready: false, failed: 1, warnings: 0, fixable: 1, errors: 0 });

    truth['a'] = true;
    const ready = await runChecks(
      profile([item('a'), item('b', { disabled: true })]),
      registry,
      rig.ctx
    );
    // b is still not met on the machine, and the setup is Ready all the same.
    expect(truth['b']).toBeUndefined();
    expect(ready).toMatchObject({ ready: true, failed: 0, warnings: 0, fixable: 0 });
    expect(ready.results[0]!.disabled).toBeUndefined();
  });

  it('is not fixed by Make ready, by its own fix, or touched by Stand down', async () => {
    const setup = profile([item('a'), item('b', { disabled: true })]);
    const made = await makeReady(setup, registry, rig.ctx);
    expect(made.steps.map((s) => s.itemId)).toEqual(['a']);
    expect(made.needsYou).toEqual([]);
    expect(truth).toEqual({ a: true });
    expect(ran.filter((r) => r.endsWith(' b'))).toEqual([]);

    const fixed = await fixItem(setup, 'b', registry, rig.ctx);
    expect(fixed?.step).toMatchObject({
      ok: false,
      skipped: true,
      message: 'This item is switched off in the setup.',
    });
    expect(fixed?.result.disabled).toBe(true);
    expect(truth['b']).toBeUndefined();

    truth['b'] = true;
    const down = await standDown(setup, registry, rig.ctx);
    expect(down.steps.map((s) => s.itemId)).toEqual(['a']);
    // What the setup does not manage is left as it is.
    expect(truth).toEqual({ a: false, b: true });
  });

  it('an unknown type or bad parameters do not matter while it is off', async () => {
    const report = await runChecks(
      profile([
        item('x', { type: 'newer.check', disabled: true }),
        item('y', { params: {}, disabled: true }),
      ]),
      registry,
      rig.ctx
    );
    expect(report.results.map((r) => [r.group, r.status, r.disabled])).toEqual([
      ['other', 'pass', true],
      ['apps', 'pass', true],
    ]);
    expect(report).toMatchObject({ ready: true, errors: 0 });
  });

  it('the flag is optional in a setup file and survives validation', () => {
    const plain = CheckItemSchema.parse({ id: 'a', type: 't', title: 'T' });
    expect(plain).not.toHaveProperty('disabled');
    expect(CheckItemSchema.parse({ id: 'a', type: 't', title: 'T', disabled: true }).disabled).toBe(
      true
    );
    expect(
      CheckItemSchema.safeParse({ id: 'a', type: 't', title: 'T', disabled: 'yes' }).success
    ).toBe(false);
  });
});
