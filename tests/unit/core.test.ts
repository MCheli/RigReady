import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLogger, nullLogger } from '../../src/core/logger';
import { isWithin, resolveAllowedPath } from '../../src/core/paths';
import { attempt, err, fromThrown, ok } from '../../src/core/result';
import { buildUsbTree, countPeripherals } from '../../src/core/usb';
import { parseVdf, steamLibraryPaths } from '../../src/core/vdf';
import { GameRegistry } from '../../src/core/games';
import { slugify } from '../../src/core/profile/schema';
import { markFull, TestClock } from '../helpers';

describe('Result', () => {
  it('carries values and errors', async () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('a.b', 'msg')).toEqual({ ok: false, error: { code: 'a.b', message: 'msg' } });
    expect(fromThrown('x', 'm', new Error('boom'))).toEqual({
      ok: false,
      error: { code: 'x', message: 'm', detail: 'boom' },
    });
    expect(await attempt('x', 'm', () => 5)).toEqual(ok(5));
    const failed = await attempt('x', 'm', () => {
      throw 'text';
    });
    expect(failed).toEqual({ ok: false, error: { code: 'x', message: 'm', detail: 'text' } });
  });
});

describe('logger', () => {
  it('writes leveled, scoped lines and filters below the level', () => {
    const lines: string[] = [];
    const log = createLogger({ write: (l) => lines.push(l) }, new TestClock(), 'info');
    log.debug('hidden');
    log.info('hello', { a: 1 });
    log.child('devices').error('bad', new Error('boom'));
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    log.warn('odd', circular);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('2026-10-03T12:00:00.000Z INFO  [app] hello {"a":1}\n');
    expect(lines[1]).toContain('ERROR [devices] bad Error: boom');
    expect(lines[2]).toContain('WARN  [app] odd [object Object]');
    nullLogger.child('x').info('nothing happens');
    nullLogger.debug('');
    nullLogger.warn('');
    nullLogger.error('');
  });
});

describe('paths', () => {
  const root = path.resolve('C:\\Data\\rig');
  it('knows what is inside a root, case-insensitively', () => {
    expect(isWithin(root, root)).toBe(true);
    expect(isWithin(root, 'c:\\data\\RIG\\profiles\\a.yaml')).toBe(true);
    expect(isWithin(root, 'C:\\Data\\rig-other\\a')).toBe(false);
    expect(isWithin(root, 'C:\\Data\\rig\\..\\secrets')).toBe(false);
  });
  it('validates renderer paths against allowed roots', () => {
    expect(resolveAllowedPath('C:\\Data\\rig\\a\\..\\b.txt', [root])).toEqual(
      ok(path.join(root, 'b.txt'))
    );
    expect(resolveAllowedPath('relative\\file', [root])).toMatchObject({
      ok: false,
      error: { code: 'path.relative' },
    });
    expect(resolveAllowedPath('C:\\Windows\\system32\\x', [root])).toMatchObject({
      ok: false,
      error: { code: 'path.outside' },
    });
    expect(resolveAllowedPath('C:\\Data\\rig\\a\0b', [root])).toMatchObject({
      ok: false,
      error: { code: 'path.invalid' },
    });
  });
});

describe('vdf', () => {
  const text = `
// comment
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"apps" { "223750" "1234" }
	}
	"1" { "path" "D:\\\\SteamLibrary" }
	"contentstatsid" "42"
}`;
  it('reads every Steam library path', () => {
    expect(steamLibraryPaths(text)).toEqual(['C:\\Program Files (x86)\\Steam', 'D:\\SteamLibrary']);
  });
  it('reads the old flat format and unquoted tokens', () => {
    expect(steamLibraryPaths('LibraryFolders { 1 "E:\\\\Games" TimeNextStatsReport 5 }')).toEqual([
      'E:\\Games',
    ]);
    expect(steamLibraryPaths('"other" { }')).toEqual([]);
    expect(parseVdf('"a" "line\\nbreak\\ttab"')).toEqual({ a: 'line\nbreak\ttab' });
  });
  it('rejects unbalanced braces', () => {
    expect(() => parseVdf('"a" { "b" "c"')).toThrow(/missing }/);
    expect(() => parseVdf('}')).toThrow(/Unexpected }/);
  });
});

describe('usb tree', () => {
  it('rebuilds the hub topology of the recorded rig', async () => {
    const rig = await markFull();
    const tree = buildUsbTree(rig.devices);
    expect(tree.length).toBeGreaterThan(0);
    expect(tree.every((root) => /ROOT_HUB/i.test(root.instanceId))).toBe(true);
    const total = tree.reduce((sum, root) => sum + countPeripherals(root), 0);
    expect(total).toBe(rig.devices.filter((d) => !d.isHub).length);
    // The pedals sit behind three hubs on this rig.
    const pedals = rig.devices.find((d) => d.vendorId === '044F' && d.productId === 'B68F')!;
    expect(pedals.hubChain.length).toBeGreaterThanOrEqual(2);
  });
});

describe('profile ids', () => {
  it('slugifies names', () => {
    expect(slugify('DCS F/A-18C')).toBe('dcs-f-a-18c');
    expect(slugify('  ***  ')).toBe('profile');
    expect(slugify('x'.repeat(100)).length).toBe(64);
  });
});

describe('GameRegistry', () => {
  it('registers modules once and lists them by name', () => {
    const registry = new GameRegistry();
    const module = (id: string, name: string) => ({
      id,
      name,
      detect: async () => ok([]),
      configLocations: async () => ok([]),
    });
    registry.register(module('b', 'Zeta'));
    registry.register(module('a', 'Alpha'));
    expect(registry.all().map((m) => m.id)).toEqual(['a', 'b']);
    expect(registry.get('a')?.name).toBe('Alpha');
    expect(() => registry.register(module('a', 'Again'))).toThrow(/twice/);
  });
});
