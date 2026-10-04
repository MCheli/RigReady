import { describe, expect, it } from 'vitest';
import { parseCommandLine } from '../../src/core/commandLine';
import {
  JUMP_LIST_SETUPS,
  TASKBAR_ICON_SIZE,
  TaskbarActivity,
  TaskbarTold,
  jumpTasks,
  paintGlyph,
  taskbarOverlay,
  thumbButtons,
} from '../../src/main/taskbarModel';
import { TONE_RGB, statusIcon, type TrayStatus } from '../../src/main/trayModel';

const setups = [
  { id: 'hornet', name: 'DCS F/A-18C', canLaunch: true, lastUsed: '2026-10-01T10:00:00.000Z' },
  { id: 'huey', name: 'DCS UH-1H', canLaunch: true, lastUsed: '2026-10-03T19:30:00.000Z' },
  { id: 'bench', name: 'Bench test', canLaunch: false },
  { id: 'gt3', name: 'iRacing GT3', canLaunch: true },
];

describe('what the taskbar is told', () => {
  it('is told again only when it is a different thing: nothing is rewritten on every check', () => {
    const told = new TaskbarTold();
    expect(told.news('the Jump List', '[]')).toBe(true);
    expect(told.news('the Jump List', '[]')).toBe(false);
    expect(told.news('the tooltip', '[]')).toBe(true);
    expect(told.news('the Jump List', '[{"title":"Fly A"}]')).toBe(true);
    expect(told.news('the Jump List', '[{"title":"Fly A"}]')).toBe(false);
    // Back to what it was before is news again.
    expect(told.news('the Jump List', '[]')).toBe(true);
  });
});

describe('WOW-WIN-004 the Jump List', () => {
  it('offers "Fly <setup>" for the setups used most recently, then the others by name', () => {
    const tasks = jumpTasks({ profileId: 'huey', profileName: 'DCS UH-1H', profiles: setups });
    expect(tasks.map((t) => t.title)).toEqual([
      'Fly DCS UH-1H',
      'Fly DCS F/A-18C',
      'Make ready: Bench test',
      'Fly iRacing GT3',
    ]);
    expect(tasks[0]).toEqual({
      title: 'Fly DCS UH-1H',
      description: 'Make the rig ready for DCS UH-1H and launch it',
      args: ['--fly=huey'],
    });
    // A setup with nothing to launch is asked for what it can do.
    expect(tasks[2]!.args).toEqual(['--make-ready=bench']);
    // Each task's arguments are a command RigReady reads back.
    for (const [index, task] of tasks.entries()) {
      const parsed = parseCommandLine(['RigReady.exe', ...task.args]);
      expect(parsed).toMatchObject({ kind: 'command' });
      expect(parsed.kind === 'command' && parsed.command.setup).toBe(
        ['huey', 'hornet', 'bench', 'gt3'][index]
      );
    }
  });

  it('is empty without setups and never longer than a list anybody reads', () => {
    expect(jumpTasks({})).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      name: `Setup ${String(i).padStart(2, '0')}`,
      canLaunch: true,
    }));
    const tasks = jumpTasks({ profiles: many });
    expect(tasks).toHaveLength(JUMP_LIST_SETUPS);
    expect(tasks[0]!.title).toBe('Fly Setup 00');
  });
});

describe('WOW-WIN-005 the taskbar button: badge, buttons and progress', () => {
  const ready: TrayStatus = { profileId: 'a', profileName: 'A', ready: true, warnings: 0 };
  const warned: TrayStatus = { profileId: 'a', profileName: 'A', ready: true, warnings: 2 };
  const notReady: TrayStatus = { profileId: 'a', profileName: 'A', ready: false, failed: 1 };

  it('the badge says the status in a shape and in words, and is absent until checks ran', () => {
    expect(taskbarOverlay({})).toBeNull();
    expect(taskbarOverlay({ profileId: 'a', profileName: 'A' })).toBeNull();
    expect(taskbarOverlay(ready)?.description).toBe('A: Ready');
    expect(taskbarOverlay(warned)?.description).toBe('A: Ready (2 warnings)');
    expect(taskbarOverlay(notReady)?.description).toBe('A: Not ready (1 problem)');
    const icon = taskbarOverlay(notReady)!.icon;
    expect([icon.width, icon.height, icon.pixels.length]).toEqual([
      TASKBAR_ICON_SIZE,
      TASKBAR_ICON_SIZE,
      TASKBAR_ICON_SIZE * TASKBAR_ICON_SIZE * 4,
    ]);

    // Three tones, three outlines: never colour alone (NFR-011).
    const size = 32;
    /** Per row: how many pixels the badge covers. */
    const footprint = (tone: keyof typeof TONE_RGB): number[] => {
      const pixels = statusIcon(size, tone);
      return Array.from({ length: size }, (_, y) => {
        let covered = 0;
        for (let x = 0; x < size; x++) if (pixels[(y * size + x) * 4 + 3] === 255) covered++;
        return covered;
      });
    };
    const [dot, triangle, square] = (['ok', 'warn', 'bad'] as const).map(footprint) as [
      number[],
      number[],
      number[],
    ];
    expect(new Set([dot, triangle, square].map((rows) => rows.join(','))).size).toBe(3);
    // A square is as wide near its top as near its bottom; a triangle is not; a dot bulges.
    expect(square[6]).toBe(square[25]);
    expect(triangle[6]!).toBeLessThan(triangle[25]!);
    expect(dot[3]!).toBeLessThan(dot[16]!);
    expect(dot[28]!).toBeLessThan(dot[16]!);
    // The colour is the status token, in the middle of the badge (BGRA).
    const centre = (tone: keyof typeof TONE_RGB): number[] => {
      const i = (18 * size + 16) * 4;
      return [...statusIcon(size, tone).subarray(i, i + 4)];
    };
    expect(centre('ok')).toEqual([0x7f, 0xb9, 0x3f, 255]);
    expect(centre('bad')).toEqual([0x5b, 0x63, 0xee, 255]);
    // The corners stay clear.
    expect([...statusIcon(size, 'ok').subarray(0, 4)]).toEqual([0, 0, 0, 0]);
  });

  it('the thumbnail buttons are the tray’s three actions, enabled when the tray’s are', () => {
    const status: TrayStatus = {
      ...ready,
      profiles: [{ id: 'a', name: 'A', canLaunch: true }],
    };
    expect(thumbButtons(status).map((b) => [b.id, b.tooltip, b.enabled])).toEqual([
      ['makeReady', 'Make ready: A', true],
      ['launch', 'Launch: A', true],
      ['standDown', 'Stand down: A', true],
    ]);
    // Nothing to launch: Launch is there and off. Windows cannot take a button away again.
    const noLaunch = { ...status, profiles: [{ id: 'a', name: 'A', canLaunch: false }] };
    expect(thumbButtons(noLaunch).map((b) => b.enabled)).toEqual([true, false, true]);
    expect(thumbButtons({}).map((b) => [b.tooltip, b.enabled])).toEqual([
      ['Make ready', false],
      ['Launch', false],
      ['Stand down', false],
    ]);
    expect(thumbButtons(status, true).map((b) => [b.tooltip, b.enabled])).toEqual([
      ['Working', false],
      ['Launch: A', false],
      ['Stand down: A', false],
    ]);
  });

  it('each button has a picture of its own', () => {
    const cover = (glyph: 'makeReady' | 'launch' | 'standDown'): number[] => {
      const pixels = paintGlyph(glyph, 32);
      return Array.from({ length: 32 * 32 }, (_, i) => pixels[i * 4 + 3]!);
    };
    const shapes = (['makeReady', 'launch', 'standDown'] as const).map(cover);
    expect(new Set(shapes.map((s) => s.join(','))).size).toBe(3);
    for (const shape of shapes) {
      // Something is drawn, and the corners are clear.
      expect(shape.filter((a) => a === 255).length).toBeGreaterThan(40);
      expect(shape[0]).toBe(0);
      expect(shape[32 * 32 - 1]).toBe(0);
    }
    for (const glyph of ['makeReady', 'launch', 'standDown'] as const) {
      const pixels = paintGlyph(glyph, 32);
      const at = Array.from({ length: 32 * 32 }, (_, i) => [...pixels.subarray(i * 4, i * 4 + 4)]);
      // Light inside with a dark edge around it: it reads on a dark taskbar and on a light one.
      expect(at.some(([b, g, r, a]) => a === 255 && b === 0xed && g === 0xe9 && r === 0xe6)).toBe(
        true
      );
      expect(at.some(([b, , , a]) => a! >= 200 && b! < 0x60)).toBe(true);
      // Smoothed: some pixels are only partly covered, and no colour is brighter than its cover.
      expect(at.some(([, , , a]) => a! > 0 && a! < 255)).toBe(true);
      expect(at.every(([b, g, r, a]) => Math.max(b!, g!, r!) <= a!)).toBe(true);
    }
    // The play triangle is wider at its left edge than near its point.
    const launch = cover('launch');
    const column = (x: number): number =>
      Array.from({ length: 32 }, (_, y) => launch[y * 32 + x]!).filter((a) => a > 0).length;
    expect(column(10)).toBeGreaterThan(column(22));
    // Every button of the model carries its picture at the size Windows is handed.
    for (const button of thumbButtons({})) {
      expect(button.icon.pixels.length).toBe(TASKBAR_ICON_SIZE * TASKBAR_ICON_SIZE * 4);
    }
  });

  it('progress: a check somebody asked for is busy; the quiet re-check every few seconds is not', () => {
    const activity = new TaskbarActivity();
    expect(activity.progress()).toEqual({ mode: 'none' });
    activity.began('fly:check', { profileId: 'a', remember: false });
    expect(activity.progress()).toEqual({ mode: 'none' });
    activity.ended('fly:check', { profileId: 'a', remember: false });
    activity.began('fly:check', { profileId: 'a' });
    expect(activity.progress()).toEqual({ mode: 'indeterminate' });
    expect(activity.busy()).toBe(false);
    activity.ended('fly:check', { profileId: 'a' });
    expect(activity.progress()).toEqual({ mode: 'none' });
    // An end without a beginning does not go below nothing.
    activity.ended('fly:check', { profileId: 'a' });
    activity.ended('fly:makeReady', {});
    expect(activity.progress()).toEqual({ mode: 'none' });
  });

  it('progress: Make ready fills as its fixes end, and is gone when it is over', () => {
    const activity = new TaskbarActivity();
    const step = (itemId: string, state: string): boolean =>
      activity.event('fly:event:progress', { runId: 'r', itemId, title: itemId, state });
    // Nothing runs: an event is not progress.
    expect(step('c1', 'running')).toBe(false);

    activity.began('fly:makeReady', { profileId: 'a', runId: 'r' });
    expect(activity.busy()).toBe(true);
    expect(activity.progress()).toEqual({ mode: 'indeterminate' });
    for (const id of ['c1', 'c2', 'c3', 'c4']) expect(step(id, 'pending')).toBe(true);
    expect(activity.progress()).toEqual({ mode: 'normal', value: 0.05 });
    step('c1', 'running');
    expect(activity.progress()).toEqual({ mode: 'normal', value: 0.05 });
    step('c1', 'done');
    expect(activity.progress()).toEqual({ mode: 'normal', value: 0.25 });
    step('c2', 'failed');
    step('c3', 'skipped');
    expect(activity.progress()).toEqual({ mode: 'normal', value: 0.75 });
    step('c4', 'done');
    expect(activity.progress()).toEqual({ mode: 'normal', value: 1 });
    // Things that are not steps change nothing.
    expect(activity.event('fly:event:result', { runId: 'r' })).toBe(false);
    expect(activity.event('fly:event:progress', 'nonsense')).toBe(false);
    activity.ended('fly:makeReady', {});
    expect(activity.busy()).toBe(false);
    expect(activity.progress()).toEqual({ mode: 'none' });
  });

  it('progress: Launch counts the steps before the game and the game, not the ones after', () => {
    const activity = new TaskbarActivity();
    activity.began('fly:launch', { profileId: 'a' });
    const step = (phase: string, id: string, state: string): boolean =>
      activity.event('fly:event:launchProgress', { runId: 'l', phase, id, title: id, state });
    step('preLaunch', 'a1', 'pending');
    step('preLaunch', 'a1', 'done');
    step('launch', 'game', 'running');
    expect(activity.progress()).toEqual({ mode: 'normal', value: 0.5 });
    expect(step('postLaunch', 'p1', 'pending')).toBe(false);
    step('launch', 'game', 'done');
    expect(activity.progress()).toEqual({ mode: 'normal', value: 1 });
    // A second action at the same time keeps it busy until both ended.
    activity.began('fly:fix', {});
    activity.ended('fly:launch', {});
    expect(activity.busy()).toBe(true);
    activity.ended('fly:fix', {});
    expect(activity.progress()).toEqual({ mode: 'none' });
  });
});
