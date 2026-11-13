import { TrainerSession, type Press, type TrainerCard, type Verdict } from './trainer';

/**
 * A round of the trainer played on live input: which of the things the controllers report
 * is the answer to the card on screen, and when the next card may come.
 *
 * A controller reports what is held, not what was meant. A lever passes buttons on its way,
 * a switch that stays where it is put holds a button per position, and a control that
 * answered one card is put back while the next card is already up. So a control that comes
 * on is weighed before it counts:
 *
 *  1. Where a control rests is not a press. The first state a controller reports, and what
 *     is held when a card comes up, can only answer after it went off and came on again.
 *  2. A control counts once it has been held for a moment (HOLD_MS), or after a clean tap:
 *     let go sooner, with nothing else on its controller changing and no lever of it
 *     travelling around the tap. A position that is only passed over is neither, and
 *     nothing is said of it. Only the control the card asks for is worth a word when it
 *     was let go too soon.
 *  3. A wrong answer needs a control that is new to the question. One that goes back to
 *     where it rested in this round, one that was in use while the card before was up, and
 *     one on a controller the round is not about are told to the user and not counted.
 *     The right control always counts.
 *  4. The next card comes when the control that answered is let go, the verdict has been
 *     up long enough to read, nothing on the controllers has changed or travelled for a
 *     moment, and every switch is back where it was when the card came up: the way back
 *     to rest happens before the card, not on it. A slow way back would otherwise end on
 *     the next card, and answer it if that card asks for the place the switch rests in.
 *     A switch that is left where it was put holds the next card back for MAX_REST_MS.
 *
 * Time is passed in, so a recorded sequence plays back the same way every time.
 */

/** A control counts as the answer once it has been held this long. */
export const HOLD_MS = 350;
/** A tap counts when its controller is this quiet before it and after it. */
export const TAP_QUIET_MS = 200;
/** A verdict stays on screen at least this long, however quickly the control is let go. */
export const SHOW_MS = 650;
/** The next card waits until the controllers have been still for this long. */
export const REST_MS = 300;
/**
 * But no longer than this, for a rig that never is: an axis that wanders, a hand on a lever,
 * a switch that is not put back.
 */
export const MAX_REST_MS = 2000;
/** Axis travel (of the full -1..1 range) that means a lever is on its way; less is jitter. */
export const AXIS_TRAVEL = 0.15;

/** What one controller reports right now. */
export interface InputFrame {
  /** DirectInput GUID of the controller, any case. */
  guid: string;
  /** Buttons and hats that are held. Axis ids among them are left out. */
  pressed: readonly string[];
  /** Axis positions by control id, -1 .. 1. */
  axes?: Readonly<Record<string, number>> | undefined;
}

/**
 * Why a press was not taken as an answer:
 * - other-device: it is on a controller this round is not about;
 * - back-to-rest: it went back to a place it rested in earlier in the round;
 * - last-card: it was in use while the card before was up;
 * - too-quick: it is the control the card asks for, and it was let go too soon, with too
 *   much else going on for a tap.
 */
export type NotCounted = 'other-device' | 'back-to-rest' | 'last-card' | 'too-quick';

export interface RoundNote {
  why: NotCounted;
  press: Press;
}

/** What a step of the round has to tell the page. */
export interface RoundStep {
  /** Answers to remember. */
  verdicts: Verdict[];
  /** This step ended the round. */
  finished: boolean;
}

interface Known {
  held: Set<string>;
  axes: Record<string, number>;
  /** Axis positions when travel was last noticed. */
  anchor: Record<string, number>;
  /** When each control last came on or went off. */
  changed: Map<string, number>;
  /** When an axis last travelled. */
  travelled: number;
}

interface Weighed {
  guid: string;
  control: string;
  /** When it came on. */
  since: number;
  /** When it was let go, if it was. */
  released: number | undefined;
  /** Nothing else has happened on its controller around it: let go early, it is a tap. */
  clean: boolean;
  /** Where the axes of its controller were when it came on. */
  axes: Record<string, number>;
}

const key = (guid: string, control: string): string => `${guid}|${control}`;

export class TrainerRound {
  readonly session: TrainerSession;
  /** The last press on this card that was not counted, and why. */
  note: RoundNote | undefined;
  /** Cards put on screen so far; the same card asked twice running counts twice. */
  shown = 1;

  private readonly known = new Map<string, Known>();
  /** The controllers of the round; undefined for all of them. */
  private readonly devices: Set<string> | undefined;
  /** Controls that came on and have not counted yet, oldest first. */
  private weighed: Weighed[] = [];
  /** Controls that were held when the round or one of its cards began. */
  private readonly rested = new Set<string>();
  /** Controls held at any time while the card on screen has been up. */
  private seen = new Set<string>();
  /** The same for the card before. */
  private carried = new Set<string>();
  /** Controls that were held when the card on screen came up: where things were. */
  private home: Press[] = [];
  private verdictAt = 0;
  /** When anything last changed or travelled on any controller. */
  private activity = -Infinity;

  constructor(
    deck: TrainerCard[],
    options: {
      now: number;
      /** GUIDs of the controllers the round is about; leave out for all of them. */
      devices?: readonly string[] | undefined;
      /** What the controllers hold as the round begins: where they rest. */
      held?: readonly InputFrame[] | undefined;
    }
  ) {
    this.session = new TrainerSession(deck);
    this.devices = options.devices
      ? new Set(options.devices.map((guid) => guid.toUpperCase()))
      : undefined;
    for (const frame of options.held ?? []) this.take(options.now, frame);
  }

  /** The controllers report. */
  input(now: number, frames: readonly InputFrame[]): RoundStep {
    for (const frame of frames) this.take(now, frame);
    return this.tick(now);
  }

  /** Time has passed. Call it when `due()` says. */
  tick(now: number): RoundStep {
    const step: RoundStep = { verdicts: [], finished: false };
    const waiting: Weighed[] = [];
    for (const w of this.weighed) {
      if ((w.released ?? now) - w.since >= HOLD_MS) this.count(w, now, step);
      else if (w.released === undefined) waiting.push(w);
      else if (!w.clean) this.passedOver(w);
      else if (now - w.released >= TAP_QUIET_MS) this.count(w, now, step);
      else waiting.push(w);
    }
    this.weighed = waiting;
    if (this.atRest(now)) this.advance(step);
    return step;
  }

  /** "Show me": gives the answer away, which counts as a miss. */
  reveal(now: number): RoundStep {
    const verdict = this.session.reveal();
    if (!verdict) return { verdicts: [], finished: false };
    this.verdictAt = now;
    this.note = undefined;
    return { verdicts: [verdict], finished: false };
  }

  /** "Next": on to the next card without waiting for the controls to rest. */
  next(): RoundStep {
    const step: RoundStep = { verdicts: [], finished: false };
    if (this.session.canAdvance) this.advance(step);
    return step;
  }

  /** When `tick` has something to do next, if time alone will bring it. */
  due(): number | undefined {
    const times = this.weighed.map((w) =>
      w.released === undefined ? w.since + HOLD_MS : w.released + TAP_QUIET_MS
    );
    const free = this.freeAt();
    if (free !== undefined) {
      const latest = free + MAX_REST_MS;
      // A switch on its way back brings the card by being put back, which is input, not time.
      times.push(this.away() ? latest : Math.max(free, Math.min(this.activity + REST_MS, latest)));
    }
    return times.length > 0 ? Math.min(...times) : undefined;
  }

  /** The control being weighed as the answer, and when it will have been held long enough. */
  get weighing(): { press: Press; since: number; until: number } | undefined {
    const w = this.weighed[0];
    if (!w || this.session.phase !== 'asking') return undefined;
    return {
      press: { guid: w.guid, control: w.control },
      since: w.since,
      until: w.released === undefined ? w.since + HOLD_MS : w.released + TAP_QUIET_MS,
    };
  }

  /**
   * The controls the card asks for that have been held since before it came up. Where a
   * control rests is not a press, so one of these answers only once it is moved away and
   * back: the user is told, because nothing else on the card says why it does not count.
   */
  get inPlace(): Press[] {
    const { card, phase } = this.session;
    if (!card || (phase !== 'asking' && phase !== 'wrong' && phase !== 'shown')) return [];
    // A control that came on while the card is up is being weighed, or has counted.
    return card.answers
      .filter(
        (a) =>
          (this.known.get(a.guid)?.held.has(a.control) ?? false) &&
          !this.weighed.some((w) => w.guid === a.guid && w.control === a.control)
      )
      .map((a) => ({ guid: a.guid, control: a.control }));
  }

  /** Whether the control that answered the card is still held. */
  get holding(): boolean {
    const answered = this.session.answered;
    return (
      answered !== undefined && (this.known.get(answered.guid)?.held.has(answered.control) ?? false)
    );
  }

  private take(now: number, frame: InputFrame): void {
    const guid = frame.guid.toUpperCase();
    const held = new Set(frame.pressed.filter((control) => !control.startsWith('axis:')));
    const axes = { ...frame.axes };
    const known = this.known.get(guid);
    if (!known) {
      // The first thing a controller says is where it rests (a switch that is on).
      this.known.set(guid, {
        held,
        axes,
        anchor: { ...axes },
        changed: new Map(),
        travelled: -Infinity,
      });
      for (const control of held) {
        this.rested.add(key(guid, control));
        this.seen.add(key(guid, control));
        this.home.push({ guid, control });
      }
      return;
    }

    let travelled = false;
    for (const [id, value] of Object.entries(axes)) {
      const from = known.anchor[id];
      if (from === undefined) known.anchor[id] = value;
      else if (Math.abs(value - from) > AXIS_TRAVEL) {
        known.anchor[id] = value;
        travelled = true;
      }
    }
    const came = [...held].filter((control) => !known.held.has(control));
    const went = [...known.held].filter((control) => !held.has(control));
    if (travelled) known.travelled = now;
    for (const control of [...came, ...went]) known.changed.set(control, now);
    if (travelled || came.length > 0 || went.length > 0) this.activity = now;

    for (const w of this.weighed) {
      if (w.guid !== guid) continue;
      // Anything else going on on its controller: let go early, this was not a tap.
      const others = [...came, ...went].some((control) => control !== w.control);
      const moved = Object.entries(axes).some(
        ([id, value]) => Math.abs(value - (w.axes[id] ?? value)) > AXIS_TRAVEL
      );
      if (others || moved) w.clean = false;
      if (w.released === undefined && went.includes(w.control)) w.released = now;
    }
    for (const control of came) {
      this.seen.add(key(guid, control));
      this.weighed = this.weighed.filter((w) => !(w.guid === guid && w.control === control));
      this.weighed.push({
        guid,
        control,
        since: now,
        released: undefined,
        clean: this.quietAround(known, control, now),
        axes,
      });
    }
    known.held = held;
    known.axes = axes;
  }

  /** Nothing else on the controller changed or travelled just before this control came on. */
  private quietAround(known: Known, control: string, now: number): boolean {
    if (now - known.travelled < TAP_QUIET_MS) return false;
    for (const [other, at] of known.changed) {
      if (other !== control && now - at < TAP_QUIET_MS) return false;
    }
    return true;
  }

  private isRight(w: Weighed): boolean {
    return (
      this.session.card?.answers.some((a) => a.guid === w.guid && a.control === w.control) ?? false
    );
  }

  /** Why this control cannot be a wrong answer to the card on screen, if it cannot. */
  private excused(w: Weighed): NotCounted | undefined {
    if (this.devices && !this.devices.has(w.guid)) return 'other-device';
    const k = key(w.guid, w.control);
    if (this.rested.has(k)) return 'back-to-rest';
    if (this.carried.has(k)) return 'last-card';
    return undefined;
  }

  /** A control has been held long enough, or tapped cleanly: it is an answer. */
  private count(w: Weighed, now: number, step: RoundStep): void {
    const session = this.session;
    const phase = session.phase;
    const right = this.isRight(w);
    const press: Press = { guid: w.guid, control: w.control };
    if (phase === 'asking' && !right) {
      const why = this.excused(w);
      if (why) {
        // Excused once for the card before: pressed again on the card after this one, it
        // is a press like any other.
        if (why === 'last-card') this.seen.delete(key(w.guid, w.control));
        this.note = { why, press };
        return;
      }
    } else if (!right || (phase !== 'asking' && phase !== 'wrong' && phase !== 'shown')) {
      // After a miss only the right control does anything; after the answer nothing does.
      return;
    }
    const verdict = session.press(press);
    if (session.phase !== phase) {
      this.verdictAt = now;
      this.note = undefined;
    }
    if (verdict) step.verdicts.push(verdict);
  }

  /**
   * A control was let go too soon to count, and it was not a clean tap: it was passed over,
   * as a lever passes positions on its way and a hand brushes a button. Nothing is said of
   * that. The one exception is the control the card asks for: the user had it, and is told
   * to hold it a moment longer.
   */
  private passedOver(w: Weighed): void {
    const phase = this.session.phase;
    const open = phase === 'asking' || phase === 'wrong' || phase === 'shown';
    if (open && this.isRight(w)) {
      this.note = { why: 'too-quick', press: { guid: w.guid, control: w.control } };
    }
  }

  /**
   * When the card on screen is done with and the answering control let go: from then on
   * the next card waits only for the controllers to be still and back where they were.
   */
  private freeAt(): number | undefined {
    const { phase, answered } = this.session;
    if ((phase !== 'right' && phase !== 'corrected') || !answered) return undefined;
    const known = this.known.get(answered.guid);
    if (known?.held.has(answered.control)) return undefined;
    return Math.max(this.verdictAt + SHOW_MS, known?.changed.get(answered.control) ?? -Infinity);
  }

  /**
   * A switch of the round that was in its place when the card came up is not there now: it
   * is on its way back, or it was left where it was put. A way back that ended on the next
   * card would answer it, if that card asks for the place the switch rests in. The control
   * that answered is not waited for: letting go of it is what brings the next card.
   */
  private away(): boolean {
    const answered = this.session.answered;
    return this.home.some(
      ({ guid, control }) =>
        (!this.devices || this.devices.has(guid)) &&
        !(answered?.guid === guid && answered.control === control) &&
        !(this.known.get(guid)?.held.has(control) ?? false)
    );
  }

  private atRest(now: number): boolean {
    const free = this.freeAt();
    if (free === undefined || now < free) return false;
    if (now - free >= MAX_REST_MS) return true;
    return now - this.activity >= REST_MS && !this.away();
  }

  private advance(step: RoundStep): void {
    this.session.advance();
    this.note = undefined;
    this.weighed = [];
    // What was touched on the card that is gone cannot fail the one that comes, and what
    // is held now is where things rest.
    this.carried = this.seen;
    this.seen = new Set();
    this.home = [];
    for (const [guid, known] of this.known) {
      for (const control of known.held) {
        this.seen.add(key(guid, control));
        this.rested.add(key(guid, control));
        this.home.push({ guid, control });
      }
    }
    if (this.session.phase === 'done') step.finished = true;
    else this.shown++;
  }
}
