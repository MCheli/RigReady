import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  becameReady,
  playReadyTone,
  READY_TONE,
  scheduleTone,
  TONE_PEAK,
  type ToneContext,
} from './tone';

/** A stand-in for the audio context that writes down everything asked of it. */
function recorder(currentTime = 10): { context: ToneContext; calls: string[] } {
  const calls: string[] = [];
  const at = (time: number): string => time.toFixed(3);
  const param = (name: string) => ({
    setValueAtTime: (value: number, time: number) => calls.push(`${name}=${value}@${at(time)}`),
    linearRampToValueAtTime: (value: number, time: number) =>
      calls.push(`${name}~${value}@${at(time)}`),
    exponentialRampToValueAtTime: (value: number, time: number) =>
      calls.push(`${name}^${value}@${at(time)}`),
  });
  let made = 0;
  const context: ToneContext = {
    currentTime,
    destination: 'speakers',
    createOscillator: () => {
      const n = ++made;
      let type = '';
      return {
        get type() {
          return type;
        },
        set type(value: string) {
          type = value;
          calls.push(`osc${n}.type=${value}`);
        },
        frequency: param(`osc${n}.frequency`),
        connect: (target: unknown) =>
          calls.push(`osc${n}->${String((target as { name: string }).name)}`),
        start: (time: number) => void calls.push(`osc${n}.start@${at(time)}`),
        stop: (time: number) => void calls.push(`osc${n}.stop@${at(time)}`),
      };
    },
    createGain: () => {
      const name = `gain${made}`;
      const node = {
        name,
        gain: param(`${name}.gain`),
        connect: (target: unknown) => calls.push(`${name}->${String(target)}`),
      };
      return node;
    },
  };
  return { context, calls };
}

describe('the ready tone', () => {
  it('is two short notes, the second a fifth above the first, over in under half a second', () => {
    expect(READY_TONE).toHaveLength(2);
    const [low, high] = READY_TONE;
    expect(high!.frequency / low!.frequency).toBeCloseTo(1.5, 2);
    const length = Math.max(...READY_TONE.map((note) => note.start + note.duration));
    expect(length).toBeLessThan(0.5);
  });

  it('is quiet: a note never gets louder than a small part of full volume', () => {
    expect(TONE_PEAK).toBeLessThanOrEqual(0.1);
    const { context, calls } = recorder();
    scheduleTone(context);
    const levels = calls
      .filter((call) => call.includes('.gain'))
      .map((call) => Number(/[=~^]([\d.]+)@/.exec(call)![1]));
    expect(Math.max(...levels)).toBe(TONE_PEAK);
  });

  it('plays each note as a sine that fades in without a click and out to silence, then stops', () => {
    const { context, calls } = recorder(10);
    const end = scheduleTone(context);
    expect(calls).toEqual([
      'osc1.type=sine',
      'osc1.frequency=659.25@10.020',
      'gain1.gain=0.0001@10.020',
      `gain1.gain~${TONE_PEAK}@10.032`,
      'gain1.gain^0.0001@10.180',
      'osc1->gain1',
      'gain1->speakers',
      'osc1.start@10.020',
      'osc1.stop@10.200',
      'osc2.type=sine',
      'osc2.frequency=987.77@10.150',
      'gain2.gain=0.0001@10.150',
      `gain2.gain~${TONE_PEAK}@10.162`,
      'gain2.gain^0.0001@10.410',
      'osc2->gain2',
      'gain2->speakers',
      'osc2.start@10.150',
      'osc2.stop@10.430',
    ]);
    expect(end).toBeCloseTo(10.41, 3);
  });

  it('is for the moment the rig becomes ready, not for staying ready', () => {
    expect(becameReady('ready', 'notReady')).toBe(true);
    expect(becameReady('warnings', 'notReady')).toBe(true);
    expect(becameReady('ready', undefined)).toBe(true);
    expect(becameReady('ready', 'ready')).toBe(false);
    expect(becameReady('ready', 'warnings')).toBe(false);
    expect(becameReady('warnings', 'ready')).toBe(false);
    expect(becameReady('notReady', 'ready')).toBe(false);
    expect(becameReady(undefined, 'ready')).toBe(false);
    expect(becameReady('notReady', undefined)).toBe(false);
  });
});

describe('playing it', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** A fresh copy of the module: it keeps one audio context for as long as it lives. */
  const fresh = async (): Promise<typeof playReadyTone> => (await import('./tone')).playReadyTone;

  function stubAudio(
    state: 'running' | 'suspended',
    resume: () => Promise<void>
  ): { made: number; notes: number } {
    const seen = { made: 0, notes: 0 };
    class FakeAudioContext {
      state = state;
      currentTime = 0;
      destination = 'speakers';
      constructor() {
        seen.made += 1;
      }
      resume = async (): Promise<void> => {
        await resume();
        this.state = 'running';
      };
      createOscillator(): unknown {
        seen.notes += 1;
        return recorder().context.createOscillator();
      }
      createGain(): unknown {
        return recorder().context.createGain();
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    return seen;
  }

  it('plays on one audio context, however often it is asked', async () => {
    vi.resetModules();
    const seen = stubAudio('running', async () => {});
    const play = await fresh();
    expect(await play()).toEqual({ played: true });
    expect(await play()).toEqual({ played: true });
    expect(seen).toEqual({ made: 1, notes: 4 });
  });

  it('wakes a sound system that is asleep first', async () => {
    vi.resetModules();
    let woken = 0;
    const seen = stubAudio('suspended', async () => {
      woken += 1;
    });
    const play = await fresh();
    expect(await play()).toEqual({ played: true });
    expect(woken).toBe(1);
    expect(seen.notes).toBe(2);
  });

  it('says so, and schedules nothing for later, when the sound system does not start', async () => {
    vi.resetModules();
    const seen = stubAudio('suspended', () => new Promise(() => {}));
    const play = await fresh();
    expect(await play()).toEqual({ played: false, reason: 'The sound system did not start.' });
    expect(seen.notes).toBe(0);
  });

  it('says why when there is no sound system at all', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('No audio device');
        }
      }
    );
    const play = await fresh();
    expect(await play()).toEqual({ played: false, reason: 'No audio device' });
  });
});
