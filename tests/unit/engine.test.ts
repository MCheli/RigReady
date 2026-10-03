import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { captureCandidates, makeReady, runChecks, standDown } from '../../src/core/checks/engine';
import { CheckRegistry } from '../../src/core/checks/registry';
import type { CheckItem, Profile } from '../../src/core/profile/schema';
import { err, ok } from '../../src/core/result';
import { markFull, rigFromState, type TestRig } from '../helpers';

let rig: TestRig;
let registry: CheckRegistry;
/** Mutable truth the test checks read. */
let truth: Record<string, boolean>;
let ran: string[];

const item = (id: string, overrides: Partial<CheckItem> = {}): CheckItem => ({
  id,
  type: 'test.flag',
  title: `Flag ${id}`,
  required: true,
  params: { flag: id },
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
    run: async (params) => ({
      pass: truth[params.flag] === true,
      summary: truth[params.flag] ? 'On' : 'Off',
    }),
    standDown: async (params) => {
      if (params.flag === 'broken') return err('x', 'cannot stand down');
      if (!truth[params.flag]) return ok(null);
      truth[params.flag] = false;
      return ok(`Turned ${params.flag} off`);
    },
  });
  registry.registerCheck({
    type: 'test.throws',
    group: 'devices',
    label: 'Throws',
    params: z.object({}),
    run: async () => {
      throw new Error('driver exploded');
    },
    standDown: async () => {
      throw new Error('stand down exploded');
    },
  });
  for (const [type, order] of [
    ['test.setLate', 300],
    ['test.setEarly', 100],
  ] as const) {
    registry.registerRemediation({
      type,
      label: type,
      order,
      params: z.object({ flag: z.string() }),
      describe: (params) => `Turn ${params.flag} on`,
      run: async (params) => {
        ran.push(params.flag);
        if (params.flag === 'stuck') return err('x', 'It would not start.', 'details');
        if (params.flag === 'throws') throw new Error('fix exploded');
        truth[params.flag] = true;
        return ok(`Turned ${params.flag} on`);
      },
    });
  }
});
afterEach(() => rig.cleanup());

describe('runChecks', () => {
  it('is ready only when every required check passes; optional failures warn and never block', async () => {
    truth = { a: true, b: false, c: false };
    const report = await runChecks(
      profile([item('a'), item('b', { required: false }), item('c')]),
      registry,
      rig.ctx
    );
    expect(report.results.map((r) => r.status)).toEqual(['pass', 'warn', 'fail']);
    expect(report).toMatchObject({ ready: false, failed: 1, warnings: 1 });

    truth['c'] = true;
    const better = await runChecks(
      profile([item('a'), item('b', { required: false }), item('c')]),
      registry,
      rig.ctx
    );
    expect(better.results.map((r) => r.status)).toEqual(['pass', 'warn', 'pass']);
    expect(better).toMatchObject({ ready: true, failed: 0, warnings: 1 });
  });

  it('describes the available fix only on checks that are not met', async () => {
    truth = { a: true };
    const remediation = { type: 'test.setEarly', params: { flag: 'x' } };
    const report = await runChecks(
      profile([
        item('a', { remediation }),
        item('b', { remediation: { type: 'test.setEarly', params: { flag: 'b' } } }),
        item('c', { remediation: { type: 'not.registered', params: {} } }),
        item('d', { remediation: { type: 'test.setEarly', params: { wrong: 1 } } }),
      ]),
      registry,
      rig.ctx
    );
    expect(report.results.map((r) => r.fix)).toEqual([
      undefined,
      'Turn b on',
      undefined,
      undefined,
    ]);
    expect(report.fixable).toBe(1);
  });

  it('turns unknown types, bad params and throwing checks into failures instead of crashing', async () => {
    const report = await runChecks(
      profile([
        item('u', { type: 'from.the.future' }),
        item('opt', { type: 'from.the.future', required: false }),
        item('bad', { params: { flag: 5 } }),
        item('t', { type: 'test.throws', params: {} }),
      ]),
      registry,
      rig.ctx
    );
    expect(report.results.map((r) => r.status)).toEqual(['fail', 'warn', 'fail', 'fail']);
    expect(report.results[0]!.summary).toContain('from.the.future');
    expect(report.results[0]!.group).toBe('other');
    expect(report.results[2]!.summary).toBe('This check is not set up correctly.');
    expect(report.results[3]!.details).toEqual(['driver exploded']);
    expect(report.ready).toBe(false);
  });

  it('an empty profile is ready', async () => {
    expect(await runChecks(profile([]), registry, rig.ctx)).toMatchObject({
      ready: true,
      results: [],
    });
  });
});

describe('makeReady', () => {
  it('runs fixes for unmet checks in remediation order and reports what happened', async () => {
    truth = { fine: true };
    const result = await makeReady(
      profile([
        item('late', { remediation: { type: 'test.setLate', params: { flag: 'late' } } }),
        item('fine', { remediation: { type: 'test.setEarly', params: { flag: 'fine' } } }),
        item('early', {
          required: false,
          remediation: { type: 'test.setEarly', params: { flag: 'early' } },
        }),
        item('stuck', { remediation: { type: 'test.setEarly', params: { flag: 'stuck' } } }),
        item('throws', { remediation: { type: 'test.setEarly', params: { flag: 'throws' } } }),
        item('badfix', { remediation: { type: 'test.setEarly', params: {} } }),
        item('nofix'),
      ]),
      registry,
      rig.ctx
    );
    // Order 100 fixes first (in profile order), then order 300; the passing check is left alone.
    expect(ran).toEqual(['early', 'stuck', 'throws', 'late']);
    expect(result.steps.map((s) => [s.itemId, s.ok, s.message])).toEqual([
      ['early', true, 'Turned early on'],
      ['stuck', false, 'It would not start. details'],
      ['throws', false, 'fix exploded'],
      ['badfix', false, 'The fix is not set up correctly.'],
      ['late', true, 'Turned late on'],
    ]);
    const status = Object.fromEntries(result.report.results.map((r) => [r.itemId, r.status]));
    expect(status).toMatchObject({
      late: 'pass',
      early: 'pass',
      fine: 'pass',
      stuck: 'fail',
      nofix: 'fail',
    });
    expect(result.report.ready).toBe(false);
  });
});

describe('standDown', () => {
  it('runs each check type stand-down and reports only what did something', async () => {
    truth = { a: true, b: false };
    const result = await standDown(
      profile([
        item('a'),
        item('b'),
        item('broken'),
        item('t', { type: 'test.throws', params: {} }),
        item('bad', { params: {} }),
      ]),
      registry,
      rig.ctx
    );
    expect(result.steps.map((s) => [s.itemId, s.ok, s.message])).toEqual([
      ['a', true, 'Turned a off'],
      ['broken', false, 'cannot stand down'],
      ['t', false, 'stand down exploded'],
    ]);
    expect(truth['a']).toBe(false);
  });
});

describe('registry', () => {
  it('rejects duplicate registrations and lists types', () => {
    expect(() =>
      registry.registerCheck({
        type: 'test.flag',
        group: 'apps',
        label: '',
        params: z.object({}),
        run: async () => ({ pass: true, summary: '' }),
      })
    ).toThrow(/twice/);
    expect(() =>
      registry.registerRemediation({
        type: 'test.setLate',
        label: '',
        order: 1,
        params: z.object({}),
        describe: () => '',
        run: async () => ok(''),
      })
    ).toThrow(/twice/);
    registry.registerCapture({ id: 'one', label: 'One', capture: async () => ok([]) });
    expect(() =>
      registry.registerCapture({ id: 'one', label: 'One', capture: async () => ok([]) })
    ).toThrow(/twice/);
    expect(registry.checkTypes()).toEqual(['test.flag', 'test.throws']);
    expect(registry.remediationTypes()).toEqual(['test.setEarly', 'test.setLate']);
  });
});

describe('captureCandidates', () => {
  it('collects candidates and reports captures that fail without losing the rest', async () => {
    registry.registerCapture({
      id: 'good',
      label: 'Good',
      capture: async () =>
        ok([
          {
            key: 'k',
            group: 'apps' as const,
            title: 'T',
            selectedByDefault: true,
            check: { type: 'test.flag', title: 'T', required: true, params: {} },
          },
        ]),
    });
    registry.registerCapture({
      id: 'bad',
      label: 'Bad',
      capture: async () => err('x', 'no access'),
    });
    registry.registerCapture({
      id: 'worse',
      label: 'Worse',
      capture: async () => {
        throw new Error('boom');
      },
    });
    const result = await captureCandidates(registry, rig.ctx);
    expect(result.candidates.map((c) => c.key)).toEqual(['k']);
    expect(result.problems).toEqual(['Bad: no access', 'Worse: boom']);
  });
});
