/**
 * The ready tone: two short, quiet notes made on the spot with Web Audio. There is no sound
 * file. It plays only when the user switched it on (Fly menu), when the rig becomes ready.
 */

export interface ToneNote {
  /** Hertz. */
  frequency: number;
  /** Seconds after the tone begins. */
  start: number;
  /** Seconds. */
  duration: number;
}

/** A rising fifth, E5 then B5: the sound of something falling into place. */
export const READY_TONE: readonly ToneNote[] = [
  { frequency: 659.25, start: 0, duration: 0.16 },
  { frequency: 987.77, start: 0.13, duration: 0.26 },
];

/** As loud as a note gets: quiet next to a game or a headset's side tone. */
export const TONE_PEAK = 0.06;
/** How quickly a note fades in, so it never clicks. */
const ATTACK = 0.012;
/** How long a sound system that is asleep is given to wake. */
const WAKE_MS = 400;

/** The parts of an AudioContext the tone uses, so it can be scheduled against a stand-in. */
export interface ToneParam {
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
  exponentialRampToValueAtTime(value: number, time: number): unknown;
}
export interface ToneNode {
  connect(target: unknown): unknown;
}
export interface ToneOscillator extends ToneNode {
  type: string;
  frequency: ToneParam;
  start(time: number): void;
  stop(time: number): void;
}
export interface ToneGain extends ToneNode {
  gain: ToneParam;
}
export interface ToneContext {
  currentTime: number;
  destination: unknown;
  createOscillator(): ToneOscillator;
  createGain(): ToneGain;
}

/**
 * Schedules the notes on an audio context: a sine per note, faded in over a few
 * milliseconds and out to silence. Returns when the last note ends (context time).
 */
export function scheduleTone(
  context: ToneContext,
  notes: readonly ToneNote[] = READY_TONE
): number {
  const begin = context.currentTime + 0.02;
  let end = begin;
  for (const note of notes) {
    const from = begin + note.start;
    const until = from + note.duration;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(note.frequency, from);
    envelope.gain.setValueAtTime(0.0001, from);
    envelope.gain.linearRampToValueAtTime(TONE_PEAK, from + ATTACK);
    envelope.gain.exponentialRampToValueAtTime(0.0001, until);
    oscillator.connect(envelope);
    envelope.connect(context.destination);
    oscillator.start(from);
    oscillator.stop(until + 0.02);
    end = Math.max(end, until);
  }
  return end;
}

let shared: AudioContext | undefined;

const running = (context: AudioContext): boolean => context.state === 'running';

/** Plays the ready tone. Says so when it could not (no audio device, or the system refused). */
export async function playReadyTone(): Promise<{ played: boolean; reason?: string }> {
  try {
    shared ??= new AudioContext();
    const context = shared;
    if (!running(context)) {
      // Not waited for without end, and nothing is scheduled on a system that is not
      // running: notes scheduled then would sound whenever it starts, out of nowhere.
      await Promise.race([
        context.resume(),
        new Promise((resolve) => setTimeout(resolve, WAKE_MS)),
      ]);
      if (!running(context)) return { played: false, reason: 'The sound system did not start.' };
    }
    scheduleTone(context);
    return { played: true };
  } catch (e) {
    return { played: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Whether readiness went from not ready (or not known yet) to ready: the moment the tone is for. */
export function becameReady(
  now: 'ready' | 'warnings' | 'notReady' | undefined,
  before: 'ready' | 'warnings' | 'notReady' | undefined
): boolean {
  const ready = (state: typeof now): boolean => state === 'ready' || state === 'warnings';
  return ready(now) && !ready(before);
}
