import { z } from 'zod';
import { CATEGORY_IDS } from './categories';
import { controlName } from './layout';
import type { Sheet } from './sheet';

/**
 * "Learn your controls": RigReady names an action, the user presses the control for it on
 * the real device. This file is the whole of it that is not a screen: which actions make
 * cards, in what order they are asked, what a press means, how missed cards come back,
 * and what is remembered per aircraft. Pure: the page and the tests drive it the same way.
 */

/** One control that does a card's action: pressing it is a right answer. */
export const TrainerAnswerSchema = z.object({
  deviceKey: z.string(),
  /** DirectInput instance GUID, upper case: how live input names the device. */
  guid: z.string(),
  device: z.string(),
  /** button:12, hat:1:U */
  control: z.string(),
  /** "Button 12" */
  name: z.string(),
});
export type TrainerAnswer = z.infer<typeof TrainerAnswerSchema>;

export const TrainerCardSchema = z.object({
  /** The action's id in the game: one card per action. */
  id: z.string().max(300),
  /** The game's own name for the action. */
  action: z.string(),
  /** A plainer wording, when one is known ("Sensor select: HUD"). Shown first, the game's name beside it. */
  plain: z.string().optional(),
  kind: z.enum(CATEGORY_IDS),
  /** Every control that does it. The first is the one shown when the answer is given away. */
  answers: z.array(TrainerAnswerSchema).min(1),
});
export type TrainerCard = z.infer<typeof TrainerCardSchema>;

const pressable = (control: string): boolean =>
  control.startsWith('button:') || control.startsWith('hat:');

/**
 * The cards of an aircraft: every action that a button or a hat of a connected controller
 * does when pressed by itself. Axes are not "pressed", a control that needs a modifier is
 * two things to learn at once, and a device that is not attached cannot be answered on. With
 * bindings of the user's own, only those are asked: what the game binds by default on every
 * device is not what anyone flies with. A card says what the sheet says: the binding guide's
 * plain name where the sheet has one, with the game's own name kept beside it.
 */
export function trainerCards(sheet: Sheet): TrainerCard[] {
  const own = sheet.devices.some((d) =>
    d.controls.some((c) => c.bindings.some((b) => b.source === 'user'))
  );
  const cards = new Map<string, TrainerCard>();
  for (const device of sheet.devices) {
    if (!device.connected || !device.guid) continue;
    for (const control of device.controls) {
      if (!pressable(control.id)) continue;
      for (const binding of control.bindings) {
        if (binding.modifiers.length > 0) continue;
        if (own && binding.source !== 'user') continue;
        const answer: TrainerAnswer = {
          deviceKey: device.key,
          guid: device.guid.toUpperCase(),
          device: device.title,
          control: control.id,
          name: controlName(control.id),
        };
        const card = cards.get(binding.actionId);
        if (card) {
          card.answers.push(answer);
          continue;
        }
        cards.set(binding.actionId, {
          id: binding.actionId,
          action: binding.action,
          ...(binding.plain && binding.plain !== binding.action ? { plain: binding.plain } : {}),
          kind: binding.kind,
          answers: [answer],
        });
      }
    }
  }
  return [...cards.values()];
}

// ---- what is remembered ----

export const CardProgressSchema = z.object({
  right: z.number().int().min(0).default(0),
  wrong: z.number().int().min(0).default(0),
  /** Right first time this many times in a row. */
  streak: z.number().int().min(0).default(0),
  last: z.string().max(40).optional(),
});
export type CardProgress = z.infer<typeof CardProgressSchema>;

export const AircraftProgressSchema = z.object({
  /** Rounds played to the end. */
  rounds: z.number().int().min(0).default(0),
  lastPlayed: z.string().max(40).optional(),
  /** By action id. */
  cards: z.record(z.string().max(300), CardProgressSchema).default({}),
});
export type AircraftProgress = z.infer<typeof AircraftProgressSchema>;

export const EMPTY_PROGRESS: AircraftProgress = { rounds: 0, cards: {} };

/** Right first time twice running: it has stuck. */
export const LEARNED_STREAK = 2;

/** One answer added to what is remembered: a miss ends the run of right answers. */
export function recordAnswer(
  progress: AircraftProgress,
  cardId: string,
  right: boolean,
  at: string
): AircraftProgress {
  const before = progress.cards[cardId] ?? { right: 0, wrong: 0, streak: 0 };
  return {
    ...progress,
    lastPlayed: at,
    cards: {
      ...progress.cards,
      [cardId]: {
        right: before.right + (right ? 1 : 0),
        wrong: before.wrong + (right ? 0 : 1),
        streak: right ? before.streak + 1 : 0,
        last: at,
      },
    },
  };
}

export interface ProgressSummary {
  /** Cards there are to learn in this aircraft now. */
  total: number;
  /** Asked at least once. */
  seen: number;
  /** Right first time twice running. */
  learned: number;
  rounds: number;
}

/** Where the user stands on the cards as they are now (a card whose binding is gone does not count). */
export function summarize(cards: TrainerCard[], progress: AircraftProgress): ProgressSummary {
  let seen = 0;
  let learned = 0;
  for (const card of cards) {
    const p = progress.cards[card.id];
    if (!p) continue;
    seen++;
    if (p.streak >= LEARNED_STREAK) learned++;
  }
  return { total: cards.length, seen, learned, rounds: progress.rounds };
}

// ---- a round ----

/** A random number source that gives the same numbers for the same seed, so a round can be replayed in a test. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface DeckOptions {
  /** How many cards a round asks. */
  size: number;
  random: () => number;
  /** Only the controls of this device. */
  deviceKey?: string;
  /** Only these cards (the ones missed last round). */
  only?: string[];
}

/**
 * The cards of one round: the ones that need it most first (never asked, then missed last
 * time, then right once, then learned), in a shuffled order within each, cut to the size of
 * a round and shuffled again so the round does not always start with the unknown.
 */
export function pickDeck(
  cards: TrainerCard[],
  progress: AircraftProgress,
  options: DeckOptions
): TrainerCard[] {
  let pool = cards;
  if (options.deviceKey) {
    pool = pool
      .map((card) => ({
        ...card,
        answers: card.answers.filter((a) => a.deviceKey === options.deviceKey),
      }))
      .filter((card) => card.answers.length > 0);
  }
  if (options.only) {
    const wanted = new Set(options.only);
    pool = pool.filter((card) => wanted.has(card.id));
  }
  const need = (card: TrainerCard): number => {
    const p = progress.cards[card.id];
    if (!p) return 0;
    if (p.streak === 0) return 1;
    return p.streak < LEARNED_STREAK ? 2 : 3;
  };
  const byNeed = [0, 1, 2, 3].flatMap((level) =>
    shuffled(
      pool.filter((card) => need(card) === level),
      options.random
    )
  );
  return shuffled(byNeed.slice(0, Math.max(1, options.size)), options.random);
}

/**
 * asking: waiting for a press. right: the first press was the right control. wrong: it was
 * another one, and the right one is now shown. shown: the user asked to be shown. corrected:
 * the right control was pressed after a miss. done: the round is over.
 */
export type TrainerPhase = 'asking' | 'right' | 'wrong' | 'shown' | 'corrected' | 'done';

export interface Press {
  /** DirectInput GUID of the controller, any case. */
  guid: string;
  /** button:12, hat:1:U */
  control: string;
}

/**
 * What a round has to tell whoever keeps the progress: a card answered right the first time
 * it is asked, or a miss. (Right after a miss earlier in the round says nothing new: the
 * answer had just been shown.)
 */
export interface Verdict {
  cardId: string;
  /** Right at the first press, without being shown. */
  right: boolean;
}

/** A missed card is asked again this many cards later. */
const COMES_BACK_AFTER = 3;
/** A card that keeps being missed is asked at most this many times in one round. */
const MAX_ASKS = 3;

export class TrainerSession {
  private readonly queue: TrainerCard[];
  private at = 0;
  private readonly asks = new Map<string, number>();
  private readonly missedIds = new Set<string>();
  /** Cards that will not be asked again this round. */
  private readonly doneIds = new Set<string>();
  private firstTry = 0;
  phase: TrainerPhase;
  /** The control that was pressed when the answer was wrong. */
  wrongPress: Press | undefined;
  /** The accepted control that was pressed, once the card is settled. */
  answered: TrainerAnswer | undefined;

  constructor(private readonly deck: TrainerCard[]) {
    this.queue = [...deck];
    this.phase = this.queue.length > 0 ? 'asking' : 'done';
    if (this.card) this.asks.set(this.card.id, 1);
  }

  /** The card being asked; undefined once the round is over. */
  get card(): TrainerCard | undefined {
    return this.phase === 'done' ? undefined : this.queue[this.at];
  }

  /** Cards of the round that are done with: answered right, or missed as often as a round asks. */
  get settled(): number {
    return this.doneIds.size;
  }

  get total(): number {
    return this.deck.length;
  }

  /** Whether the card on screen will be asked again later in this round. */
  get comesBack(): boolean {
    const card = this.card;
    return card !== undefined && this.queue.slice(this.at + 1).some((c) => c.id === card.id);
  }

  private accepted(press: Press): TrainerAnswer | undefined {
    const guid = press.guid.toUpperCase();
    return this.card?.answers.find((a) => a.guid === guid && a.control === press.control);
  }

  private miss(): Verdict {
    const card = this.card!;
    this.missedIds.add(card.id);
    // It comes back a few cards later, unless it has been asked often enough.
    if ((this.asks.get(card.id) ?? 1) < MAX_ASKS) {
      const again = Math.min(this.queue.length, this.at + 1 + COMES_BACK_AFTER);
      this.queue.splice(again, 0, card);
    } else {
      this.doneIds.add(card.id);
    }
    return { cardId: card.id, right: false };
  }

  /**
   * A control was pressed. Answers with the verdict to remember when this press decided
   * the card (right, or wrong for the first time), and with nothing otherwise.
   */
  press(press: Press): Verdict | undefined {
    const card = this.card;
    if (!card) return undefined;
    const hit = this.accepted(press);
    if (this.phase === 'asking') {
      if (hit) {
        this.phase = 'right';
        this.answered = hit;
        this.doneIds.add(card.id);
        if (!this.missedIds.has(card.id)) this.firstTry++;
        // Right after having been missed earlier in the round does not count as known.
        return this.missedIds.has(card.id) ? undefined : { cardId: card.id, right: true };
      }
      this.phase = 'wrong';
      this.wrongPress = { guid: press.guid.toUpperCase(), control: press.control };
      return this.miss();
    }
    if ((this.phase === 'wrong' || this.phase === 'shown') && hit) {
      this.phase = 'corrected';
      this.answered = hit;
    }
    return undefined;
  }

  /** "Show me": gives the answer away, which counts as a miss. */
  reveal(): Verdict | undefined {
    if (this.phase !== 'asking') return undefined;
    this.phase = 'shown';
    return this.miss();
  }

  /** Whether the card on screen is done with and the next one may come. */
  get canAdvance(): boolean {
    return this.phase !== 'asking' && this.phase !== 'done';
  }

  /** On to the next card, or to the end of the round. */
  advance(): void {
    if (!this.canAdvance) return;
    this.at++;
    this.wrongPress = undefined;
    this.answered = undefined;
    const next = this.queue[this.at];
    if (!next) {
      this.phase = 'done';
      return;
    }
    this.asks.set(next.id, (this.asks.get(next.id) ?? 0) + 1);
    this.phase = 'asking';
  }

  /** How the round went. */
  results(): { asked: number; firstTry: number; missed: TrainerCard[] } {
    return {
      asked: this.deck.length,
      firstTry: this.firstTry,
      missed: this.deck.filter((card) => this.missedIds.has(card.id)),
    };
  }
}
