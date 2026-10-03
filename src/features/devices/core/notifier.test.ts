import { describe, expect, it } from 'vitest';
import type { DeviceInfo } from '../../../shared/models';
import { ConnectionNotifier, diffDevices, type Timers } from './notifier';

/** Timers that only run when the test moves time on. */
class ManualTimers implements Timers {
  now = 0;
  private next = 1;
  private queue = new Map<number, { at: number; fn: () => void }>();
  set(fn: () => void, ms: number): unknown {
    const id = this.next++;
    this.queue.set(id, { at: this.now + ms, fn });
    return id;
  }
  clear(handle: unknown): void {
    this.queue.delete(handle as number);
  }
  advance(ms: number): void {
    const until = this.now + ms;
    for (;;) {
      const due = [...this.queue.entries()]
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.queue.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
    }
    this.now = until;
  }
}

const device = (name: string, over: Partial<DeviceInfo> = {}): DeviceInfo => ({
  instanceId: `USB\\VID_4098&PID_0001\\${name}`,
  vendorId: '4098',
  productId: '0001',
  name,
  isHid: true,
  isGameController: true,
  isHub: false,
  hubChain: [],
  ...over,
});

function setup(wanted: (d: DeviceInfo) => boolean = () => true) {
  const timers = new ManualTimers();
  const sent: { title: string; body: string; at: number }[] = [];
  const notifier = new ConnectionNotifier({
    notify: (title, body) => sent.push({ title, body, at: timers.now }),
    wanted,
    label: (d) => (d.name === 'Pedals' ? 'Rudder pedals' : d.name),
    timers,
  });
  return { timers, sent, notifier };
}

describe('connect and disconnect notifications', () => {
  it('tells about an unplugged device within 2 s, by the name the user gave it', () => {
    const { timers, sent, notifier } = setup();
    notifier.changed([], [device('Pedals')]);
    timers.advance(999);
    expect(sent).toEqual([]);
    timers.advance(1);
    expect(sent).toEqual([
      { title: 'Rudder pedals disconnected', body: 'It was unplugged or lost power.', at: 1000 },
    ]);
    // Plugged back in after the quiet time: a new notification.
    timers.advance(3000);
    notifier.changed([device('Pedals')], []);
    timers.advance(1000);
    expect(sent.at(-1)).toMatchObject({ title: 'Rudder pedals connected', body: 'Ready to use.' });
    // Unplugged, then plugged back in within the quiet time: one follow-up once it has settled.
    timers.advance(3000);
    notifier.changed([], [device('Pedals')]);
    timers.advance(1000);
    notifier.changed([device('Pedals')], []);
    timers.advance(3000);
    expect(sent.map((s) => s.title).slice(-2)).toEqual([
      'Rudder pedals disconnected',
      'Rudder pedals is back',
    ]);
  });

  it('merges a device that drops out and comes back within 3 s into one notification', () => {
    const { timers, sent, notifier } = setup();
    const throttle = device('Throttle');
    notifier.changed([], [throttle]);
    timers.advance(300);
    notifier.changed([throttle], []);
    timers.advance(700);
    expect(sent.map((s) => s.title)).toEqual(['Throttle dropped out']);
    expect(sent[0]!.body).toContain('disconnected and came back');
    // More flapping right after is held back; it ends connected, as told, so nothing more.
    for (let i = 0; i < 4; i++) {
      notifier.changed([], [throttle]);
      timers.advance(200);
      notifier.changed([throttle], []);
      timers.advance(200);
    }
    timers.advance(5000);
    expect(sent).toHaveLength(1);
  });

  it('follows up once when a flapping device ends up gone', () => {
    const { timers, sent, notifier } = setup();
    const stick = device('Stick');
    notifier.changed([], [stick]);
    notifier.changed([stick], []);
    notifier.changed([], [stick]);
    timers.advance(1000);
    // Gone, back, gone again within the settle time: told once, as gone.
    expect(sent.map((s) => s.title)).toEqual(['Stick disconnected']);
    notifier.changed([stick], []);
    timers.advance(500);
    notifier.changed([], [stick]);
    timers.advance(3000);
    expect(sent.map((s) => s.title)).toEqual(['Stick disconnected']);

    const { timers: t2, sent: s2, notifier: n2 } = setup();
    n2.changed([], [stick]);
    t2.advance(1000);
    n2.changed([stick], []);
    t2.advance(3000);
    expect(s2.map((s) => s.title)).toEqual(['Stick disconnected', 'Stick is back']);
  });

  it('tells about a whole hub in one notification, and only about wanted devices', () => {
    const { timers, sent, notifier } = setup((d) => d.isGameController);
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    notifier.changed(
      [],
      [
        ...names.map((n) => device(n)),
        device('Keyboard', { isGameController: false }),
        device('Hub', { isHub: true }),
      ]
    );
    timers.advance(1000);
    expect(sent).toEqual([
      { title: '6 devices disconnected', body: 'A, B, C, D and 2 more', at: 1000 },
    ]);
    notifier.dispose();
  });

  it('stays quiet when nothing is wanted', () => {
    const { timers, sent, notifier } = setup(() => false);
    notifier.changed([device('A')], []);
    timers.advance(1000);
    notifier.changed([], [device('A')]);
    timers.advance(4000);
    expect(sent).toEqual([]);
  });

  it('works out what was plugged in and removed', () => {
    const a = device('A');
    const b = device('B');
    const hub = device('H', { isHub: true });
    expect(diffDevices([a, hub], [b])).toEqual({ added: [b], removed: [a] });
    expect(diffDevices([a], [{ ...a, instanceId: a.instanceId.toLowerCase() }])).toEqual({
      added: [],
      removed: [],
    });
  });
});
