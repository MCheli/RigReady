import { describe, expect, it } from 'vitest';
import { describeThrown, ErrorCenter, errorDetails } from '../../src/core/errorCenter';

const at = (): Date => new Date('2026-10-03T12:00:00.000Z');

describe('the error center', () => {
  it('describes whatever was thrown in one line, with the stack as detail', () => {
    const error = new Error('boom');
    expect(describeThrown(error)).toEqual({ message: 'boom', detail: error.stack });
    expect(describeThrown(new TypeError(''))).toMatchObject({ message: 'TypeError' });
    expect(describeThrown('plain text')).toEqual({ message: 'plain text' });
    expect(describeThrown('')).toEqual({ message: 'Error' });
    expect(describeThrown({ code: 5 })).toEqual({ message: '{"code":5}' });
    expect(describeThrown(undefined)).toEqual({ message: 'undefined' });
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(describeThrown(circular)).toEqual({ message: '[object Object]' });
    const bare = new Error('no stack');
    delete bare.stack;
    expect(describeThrown(bare)).toEqual({ message: 'no stack' });
  });

  it('keeps reports, counts repeats, tells listeners and survives a listener that throws', () => {
    const center = new ErrorCenter(at);
    const seen: string[] = [];
    center.subscribe(() => {
      throw new Error('listener failed');
    });
    const off = center.subscribe((report) => seen.push(`${report.id}:${report.count}`));
    const first = center.report('main', new Error('boom'));
    center.report('main', new Error('boom'));
    center.report('window', 'boom', 'at Page.vue');
    expect(first).toMatchObject({ id: 'e1', time: '2026-10-03T12:00:00.000Z', source: 'main' });
    expect(seen).toEqual(['e1:1', 'e1:2', 'e2:1']);
    expect(center.all().map((r) => [r.source, r.message, r.count])).toEqual([
      ['main', 'boom', 2],
      ['window', 'boom', 1],
    ]);
    expect(center.get('e2')).toMatchObject({ detail: 'at Page.vue' });
    expect(center.get('e9')).toBeUndefined();
    off();
    center.report('process', 'helper died');
    expect(seen).toHaveLength(3);
  });

  it('dismissed reports are not shown again until they happen again', () => {
    const center = new ErrorCenter(at);
    const a = center.report('main', 'a');
    center.report('main', 'b');
    center.dismiss([a.id]);
    expect(center.unseen().map((r) => r.message)).toEqual(['b']);
    center.dismiss();
    expect(center.unseen()).toEqual([]);
    expect(center.all()).toHaveLength(2);
    center.report('main', 'a');
    expect(center.unseen().map((r) => [r.message, r.count])).toEqual([['a', 2]]);
  });

  it('masks secrets and user folders, bounds what it keeps, and can be reset', () => {
    const center = new ErrorCenter(at);
    const report = center.report(
      'main',
      new Error('401 with sk-ant-api03-abcdefghijklmnop in C:\\Users\\jane\\x.js')
    );
    expect(report.message).toBe('401 with sk-ant-*** in C:\\Users\\~\\x.js');
    expect(report.detail).not.toContain('jane');
    expect(center.report('main', 'x'.repeat(5000)).message).toHaveLength(500);
    for (let i = 0; i < 80; i++) center.report('window', `error ${i}`);
    expect(center.all()).toHaveLength(50);
    expect(center.all()[49]!.message).toBe('error 79');
    expect(center.unseen()).toHaveLength(50);
    center.reset();
    expect(center.all()).toEqual([]);
    expect(center.report('main', 'again').id).toBe('e1');
  });

  it('writes the details one would paste into a bug report', () => {
    const center = new ErrorCenter(at);
    center.report('window', 'render failed', 'at Fly.vue:3');
    const twice = center.report('window', 'render failed');
    expect(errorDetails(twice, { version: '2.0.0', os: 'Windows 11 Pro 10.0.26200 (x64)' })).toBe(
      [
        'RigReady 2.0.0 on Windows 11 Pro 10.0.26200 (x64)',
        '2026-10-03T12:00:00.000Z unexpected error in window (2 times)',
        'render failed',
        '',
        'at Fly.vue:3',
      ].join('\n')
    );
    const plain = center.report('process', 'gpu helper stopped');
    expect(errorDetails(plain, { version: '2.0.0', os: 'W' })).toBe(
      'RigReady 2.0.0 on W\n2026-10-03T12:00:00.000Z unexpected error in process\ngpu helper stopped'
    );
  });
});
