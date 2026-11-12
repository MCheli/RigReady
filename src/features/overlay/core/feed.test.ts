import { describe, expect, it } from 'vitest';
import { PressFeed, SAME_MOVE_MS } from './feed';

const feed = (rows = 5, lifetimeMs = 5000): PressFeed<string> =>
  new PressFeed({ lifetimeMs, rows });

/** "Gear up", or "Gear up x3" when it was pressed three times running. */
const shown = (list: PressFeed<string>, now: number): string[] =>
  list.rows(now).map((row) => (row.count > 1 ? `${row.what} x${row.count}` : row.what));

describe('the list of recent presses', () => {
  it('the newest press is first', () => {
    const list = feed();
    list.press(0, 'stick', 'JOY_BTN1', 'Trigger');
    list.press(300, 'stick', 'JOY_BTN2', 'Weapon release');
    list.press(600, 'throttle', 'JOY_BTN1', 'Speed brake');
    expect(shown(list, 700)).toEqual(['Speed brake', 'Weapon release', 'Trigger']);
  });

  it('a press stays for its time and is gone after it, whether or not it is still held', () => {
    const list = feed();
    list.press(1000, 'stick', 'JOY_BTN1', 'Trigger');
    expect(shown(list, 5999)).toEqual(['Trigger']);
    expect(shown(list, 6000)).toEqual([]);
  });

  it('each line goes at its own time', () => {
    const list = feed();
    list.press(0, 'stick', 'JOY_BTN1', 'Trigger');
    list.press(3000, 'stick', 'JOY_BTN2', 'Weapon release');
    expect(shown(list, 5500)).toEqual(['Weapon release']);
    expect(shown(list, 8000)).toEqual([]);
  });

  it('says when each was pressed, for the fading', () => {
    const list = feed();
    list.press(1000, 'stick', 'JOY_BTN1', 'Trigger');
    expect(list.rows(1200)).toEqual([{ id: 1, count: 1, stamp: 1000, what: 'Trigger' }]);
  });

  it('pressing the same control again counts up and starts its time again, without a new line', () => {
    const list = feed();
    list.press(0, 'stick', 'JOY_BTN4', 'Trim up');
    list.release(100, 'stick', 'JOY_BTN4');
    list.press(400, 'stick', 'JOY_BTN4', 'Trim up');
    list.release(500, 'stick', 'JOY_BTN4');
    list.press(4000, 'stick', 'JOY_BTN4', 'Trim up');
    expect(list.rows(4100)).toEqual([{ id: 1, count: 3, stamp: 4000, what: 'Trim up' }]);
    // Five seconds from the last press, not from the first.
    expect(shown(list, 8999)).toEqual(['Trim up x3']);
    expect(shown(list, 9000)).toEqual([]);
  });

  it('the same control after another one is a line of its own: the list is what happened, in order', () => {
    const list = feed();
    list.press(0, 'stick', 'JOY_BTN1', 'Trigger');
    list.release(200, 'stick', 'JOY_BTN1');
    list.press(1000, 'stick', 'JOY_BTN2', 'Weapon release');
    list.release(1200, 'stick', 'JOY_BTN2');
    list.press(2000, 'stick', 'JOY_BTN1', 'Trigger');
    expect(shown(list, 2100)).toEqual(['Trigger', 'Weapon release', 'Trigger']);
  });

  it('the same input on another controller is another control', () => {
    const list = feed();
    list.press(0, 'stick', 'JOY_BTN1', 'Trigger');
    list.press(100, 'throttle', 'JOY_BTN1', 'Speed brake');
    expect(shown(list, 200)).toEqual(['Speed brake', 'Trigger']);
  });

  it('shows at most so many: the oldest makes room, the newest is always there', () => {
    const list = feed(3);
    for (let n = 1; n <= 5; n++) list.press(n * 500, 'stick', `JOY_BTN${n}`, `Action ${n}`);
    expect(shown(list, 2600)).toEqual(['Action 5', 'Action 4', 'Action 3']);
  });

  it('new limits apply to what is shown already', () => {
    const list = feed(5, 5000);
    for (let n = 1; n <= 4; n++) list.press(n * 100, 'stick', `JOY_BTN${n}`, `Action ${n}`);
    list.configure({ rows: 2, lifetimeMs: 5000 }, 450);
    expect(shown(list, 500)).toEqual(['Action 4', 'Action 3']);
    list.configure({ rows: 2, lifetimeMs: 200 }, 500);
    expect(shown(list, 550)).toEqual(['Action 4']);
    // Never fewer than one, whatever is asked.
    list.configure({ rows: 0, lifetimeMs: 5000 }, 560);
    list.press(600, 'stick', 'JOY_BTN7', 'Action 7');
    expect(shown(list, 610)).toEqual(['Action 7']);
  });

  it('a longer time does not bring back a line whose time was over', () => {
    const list = feed(5, 5000);
    list.press(0, 'stick', 'JOY_BTN1', 'Trigger');
    list.press(4000, 'stick', 'JOY_BTN2', 'Weapon release');
    // Six seconds on, and nothing has read the list since: the first is over, the second is not.
    list.configure({ rows: 5, lifetimeMs: 30_000 }, 6000);
    expect(shown(list, 6100)).toEqual(['Weapon release']);
    // Pressed again, the first is a first press, not a second.
    list.press(6200, 'stick', 'JOY_BTN1', 'Trigger');
    expect(shown(list, 6300)).toEqual(['Trigger', 'Weapon release']);
  });

  it('cleared, it is empty', () => {
    const list = feed();
    list.press(0, 'stick', 'JOY_BTN1', 'Trigger');
    list.clear();
    expect(shown(list, 10)).toEqual([]);
  });
});

describe('a control with several positions is one line that changes', () => {
  it('a lever passing five positions leaves one line, the position it stopped at', () => {
    const list = feed();
    list.press(0, 'stick', 'JOY_BTN1', 'Trigger');
    // Each position lets go as the next is taken, in the same state of the controller.
    let now = 1000;
    list.press(now, 'throttle', 'JOY_BTN20', 'Detent 1');
    for (let n = 2; n <= 5; n++) {
      now += 60;
      list.release(now, 'throttle', `JOY_BTN${18 + n}`);
      list.press(now, 'throttle', `JOY_BTN${19 + n}`, `Detent ${n}`);
    }
    expect(shown(list, now + 10)).toEqual(['Detent 5', 'Trigger']);
    // One line all the way: the same id, counted once, timed from the last position.
    expect(list.rows(now + 10)[0]).toEqual({ id: 2, count: 1, stamp: now, what: 'Detent 5' });
  });

  it('also when the next position is reported a moment after the one before was let go', () => {
    const list = feed();
    list.press(0, 'panel', 'JOY_BTN7', 'Flaps up');
    list.release(2000, 'panel', 'JOY_BTN7');
    list.press(2000 + SAME_MOVE_MS, 'panel', 'JOY_BTN8', 'Flaps half');
    expect(shown(list, 2100)).toEqual(['Flaps half']);
  });

  it('and when the next position is taken a moment before the one before is let go', () => {
    const list = feed();
    list.press(0, 'panel', 'JOY_BTN7', 'Flaps up');
    list.press(2000, 'panel', 'JOY_BTN8', 'Flaps half');
    expect(shown(list, 2001)).toEqual(['Flaps half', 'Flaps up']);
    expect(list.release(2000 + SAME_MOVE_MS, 'panel', 'JOY_BTN7')).toBe(true);
    expect(shown(list, 2100)).toEqual(['Flaps half']);
  });

  it('a line that changed position comes to the top', () => {
    const list = feed();
    list.press(0, 'panel', 'JOY_BTN7', 'Flaps up');
    list.press(500, 'stick', 'JOY_BTN1', 'Trigger');
    list.release(1000, 'panel', 'JOY_BTN7');
    list.press(1000, 'panel', 'JOY_BTN8', 'Flaps half');
    expect(shown(list, 1100)).toEqual(['Flaps half', 'Trigger']);
  });

  it('back and forth between two positions stays one line, counted once', () => {
    const list = feed();
    list.press(0, 'panel', 'JOY_BTN7', 'Flaps up');
    list.release(300, 'panel', 'JOY_BTN7');
    list.press(300, 'panel', 'JOY_BTN8', 'Flaps half');
    list.release(600, 'panel', 'JOY_BTN8');
    list.press(600, 'panel', 'JOY_BTN7', 'Flaps up');
    expect(list.rows(700)).toEqual([{ id: 1, count: 1, stamp: 600, what: 'Flaps up' }]);
  });

  it('two buttons pressed one after the other stay two lines', () => {
    const list = feed();
    list.press(0, 'stick', 'JOY_BTN1', 'Trigger');
    list.release(400, 'stick', 'JOY_BTN1');
    list.press(400 + SAME_MOVE_MS + 1, 'stick', 'JOY_BTN2', 'Weapon release');
    expect(shown(list, 500)).toEqual(['Weapon release', 'Trigger']);
  });

  it('a button let go while another is held does not take the other away', () => {
    const list = feed();
    list.press(0, 'stick', 'JOY_BTN1', 'Trigger');
    list.press(1000, 'stick', 'JOY_BTN2', 'Weapon release');
    // Long after the second was pressed.
    expect(list.release(1500, 'stick', 'JOY_BTN1')).toBe(false);
    // And letting go of the newest never removes anything.
    expect(list.release(1510, 'stick', 'JOY_BTN2')).toBe(false);
    expect(shown(list, 1600)).toEqual(['Weapon release', 'Trigger']);
  });

  it('a release on one controller and a press on another are not one control', () => {
    const list = feed();
    list.press(0, 'stick', 'JOY_BTN1', 'Trigger');
    list.release(1000, 'stick', 'JOY_BTN1');
    list.press(1000, 'throttle', 'JOY_BTN1', 'Speed brake');
    expect(shown(list, 1100)).toEqual(['Speed brake', 'Trigger']);
  });

  it('a position that came from one that is not shown is a line like any other', () => {
    const list = feed();
    // The switch rested in a position that was never pressed while the overlay was on.
    list.release(1000, 'panel', 'JOY_BTN7');
    list.press(1000, 'panel', 'JOY_BTN8', 'Flaps half');
    expect(shown(list, 1100)).toEqual(['Flaps half']);
    // And a release with nothing shown changes nothing.
    expect(list.release(1100, 'panel', 'JOY_BTN9')).toBe(false);
  });
});
