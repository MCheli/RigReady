import { describe, expect, it } from 'vitest';
import type { TrainerAnswer, TrainerCard } from './trainer';
import {
  HOLD_MS,
  MAX_REST_MS,
  REST_MS,
  SHOW_MS,
  TAP_QUIET_MS,
  TrainerRound,
  type InputFrame,
  type RoundStep,
} from './trainerRound';

/*
 * The answer rule, played back from recordings: each row is what one controller reported
 * at one moment (milliseconds), as the input sidecar reports it. The round is driven the
 * way the page drives it: every report goes in, and `tick` is called when `due` says.
 */

const THROTTLE = 'THROTTLE-1';
const STICK = 'STICK-1';
const PANEL = 'PANEL-1';

const id = (control: number | string): string =>
  typeof control === 'number' ? `button:${control}` : control;
const on = (guid: string, control: number | string): TrainerAnswer => ({
  deviceKey: guid,
  guid,
  device: guid,
  control: id(control),
  name: id(control),
});
const card = (cardId: string, ...answers: TrainerAnswer[]): TrainerCard => ({
  id: cardId,
  action: cardId,
  kind: 'other',
  answers,
});

/** At this time, this controller holds these, with its axes here. */
type Row = [at: number, guid: string, held: (number | string)[], axes?: Record<string, number>];
const frame = ([, guid, held, axes]: Row): InputFrame => ({ guid, pressed: held.map(id), axes });

/** A round that starts at time 0 with the controllers resting as given. */
const begin = (deck: TrainerCard[], rest: Row[], devices?: string[]): TrainerRound =>
  new TrainerRound(deck, { now: 0, held: rest.map(frame), devices });

/**
 * Plays a recording into a round up to `until`, and says what happened when: verdicts to
 * keep, the card and phase on screen whenever they change, and presses that were not counted.
 */
function play(round: TrainerRound, rows: Row[], until: number): string[] {
  const log: string[] = [];
  const screen = (): string => `${round.session.phase} ${round.session.card?.id ?? '-'}`;
  let was = `${screen()} #${round.shown}`;
  let noted = round.note;
  const look = (at: number, step: RoundStep): void => {
    for (const verdict of step.verdicts) {
      log.push(`${at} kept ${verdict.cardId} ${verdict.right ? 'right' : 'missed'}`);
    }
    if (round.note !== noted) {
      noted = round.note;
      if (noted) log.push(`${at} not counted ${noted.press.control}: ${noted.why}`);
    }
    const now = `${screen()} #${round.shown}`;
    if (now !== was) log.push(`${at} ${screen()}`);
    was = now;
    if (step.finished) log.push(`${at} finished`);
  };
  const pass = (to: number): void => {
    for (let guard = 0; guard < 1000; guard++) {
      const due = round.due();
      if (due === undefined || due > to) return;
      look(due, round.tick(due));
    }
    throw new Error('the round never comes to rest');
  };
  for (const row of rows) {
    pass(row[0] - 1);
    look(row[0], round.input(row[0], [frame(row)]));
  }
  pass(until);
  return log;
}

const two = [card('a', on(THROTTLE, 5)), card('b', on(THROTTLE, 6))];

describe('a plain button', () => {
  it('tapped, is the answer a moment after it is let go, and the next card follows', () => {
    const round = begin(two, [[0, THROTTLE, []]]);
    expect(
      play(
        round,
        [
          [1000, THROTTLE, [5]],
          [1090, THROTTLE, []],
        ],
        5000
      )
    ).toEqual(['1290 kept a right', '1290 right a', '1940 asking b']);
    expect(round.session.results()).toMatchObject({ firstTry: 1, missed: [] });
  });

  it('held, is the answer after a short hold, and letting go brings the next card', () => {
    const quick = begin(two, [[0, THROTTLE, []]]);
    expect(
      play(
        quick,
        [
          [1000, THROTTLE, [5]],
          [1700, THROTTLE, []],
        ],
        5000
      )
    ).toEqual(['1350 kept a right', '1350 right a', '2000 asking b']);

    // Held for as long as the user likes: the card waits, then the controls rest a moment.
    const slow = begin(two, [[0, THROTTLE, []]]);
    const rows: Row[] = [[1000, THROTTLE, [5]]];
    expect(play(slow, rows, 2999)).toEqual(['1350 kept a right', '1350 right a']);
    expect(slow.holding).toBe(true);
    expect(slow.due()).toBeUndefined();
    expect(play(slow, [[3000, THROTTLE, []]], 5000)).toEqual(['3300 asking b']);
    expect(slow.holding).toBe(false);
  });

  it('is not made slow: a press is judged within the hold, the next card within a second', () => {
    expect(HOLD_MS).toBeLessThanOrEqual(400);
    // A tap of up to 150 ms is judged no later than a press that is held.
    expect(150 + TAP_QUIET_MS).toBeLessThanOrEqual(HOLD_MS);
    // After a tap the controls have rested before the verdict has been read.
    expect(REST_MS).toBeLessThan(SHOW_MS);
    expect(HOLD_MS + SHOW_MS).toBeLessThanOrEqual(1000);
  });

  it('says what is being weighed while it is held', () => {
    const round = begin(two, [[0, THROTTLE, []]]);
    expect(round.weighing).toBeUndefined();
    round.input(1000, [{ guid: 'throttle-1', pressed: ['button:5'] }]);
    // Lower-case GUIDs are the same controller.
    expect(round.weighing).toEqual({
      press: { guid: THROTTLE, control: 'button:5' },
      since: 1000,
      until: 1000 + HOLD_MS,
    });
    expect(round.due()).toBe(1000 + HOLD_MS);
    round.tick(1000 + HOLD_MS);
    expect(round.session.phase).toBe('right');
    expect(round.weighing).toBeUndefined();
  });

  it('that is the wrong one is a miss, and after it only the right one goes on', () => {
    const round = begin(two, [[0, THROTTLE, []]]);
    expect(
      play(
        round,
        [
          [1000, THROTTLE, [9]],
          [1500, THROTTLE, []],
          // Another wrong one: not a second miss.
          [2000, THROTTLE, [8]],
          [2600, THROTTLE, []],
          [3000, THROTTLE, [5]],
          [3500, THROTTLE, []],
        ],
        6000
      )
    ).toEqual(['1350 kept a missed', '1350 wrong a', '3350 corrected a', '4000 asking b']);
    expect(round.session.results()).toMatchObject({ firstTry: 0, missed: [two[0]] });
  });

  it('pressed twice quickly, is one answer', () => {
    const round = begin(two, [[0, THROTTLE, []]]);
    expect(
      play(
        round,
        [
          [1000, THROTTLE, [5]],
          [1080, THROTTLE, []],
          [1150, THROTTLE, [5]],
          [1230, THROTTLE, []],
        ],
        5000
      )
    ).toEqual(['1430 kept a right', '1430 right a', '2080 asking b']);
  });
});

describe('a lever with buttons along its travel', () => {
  // The stick's twist lever rests on Button 2 and passes 41, 42 and 3 one way, 1 the other.
  const rest: Row[] = [[0, STICK, [2, 7], { 'axis:RZ': -0.8 }]];
  const deck = [card('x', on(STICK, 42)), card('y', on(STICK, 9))];

  it('answers with where it stops, not with what it passes, there and back', () => {
    const round = begin(deck, rest);
    expect(
      play(
        round,
        [
          [1000, STICK, [7], { 'axis:RZ': -0.6 }],
          [1040, STICK, [7, 41], { 'axis:RZ': -0.3 }],
          [1160, STICK, [7], { 'axis:RZ': 0.1 }],
          [1200, STICK, [7, 42], { 'axis:RZ': 0.4 }],
          // ...and back to where it rests, through 41 again.
          [3000, STICK, [7], { 'axis:RZ': 0.1 }],
          [3050, STICK, [7, 41], { 'axis:RZ': -0.3 }],
          [3150, STICK, [7], { 'axis:RZ': -0.5 }],
          [3200, STICK, [2, 7], { 'axis:RZ': -0.8 }],
        ],
        8000
      )
    ).toEqual([
      '1550 kept x right',
      '1550 right x',
      // The next card waited for the lever to be back and still.
      '3500 asking y',
    ]);
    expect(round.note).toBeUndefined();
  });

  it('is not answered by a position it only passes, however slowly, with no axis to tell', () => {
    const round = begin(deck, [[0, STICK, [2, 7]]]);
    expect(
      play(
        round,
        [
          [1000, STICK, [7]],
          [1150, STICK, [1, 7]],
          [1450, STICK, [7]],
        ],
        8000
      )
    ).toEqual([]);
    expect(round.note).toBeUndefined();
    expect(round.session.phase).toBe('asking');
    expect(round.session.results().missed).toEqual([]);
  });

  // Of the positions it passes, only the one the card asks for is told as let go too soon.
  it('swept through the right position without stopping, is answered by where it stopped', () => {
    const round = begin([card('x', on(STICK, 41)), card('y', on(STICK, 9))], rest);
    expect(
      play(
        round,
        [
          [1000, STICK, [7], { 'axis:RZ': -0.6 }],
          [1040, STICK, [7, 41], { 'axis:RZ': -0.3 }],
          [1160, STICK, [7], { 'axis:RZ': 0.1 }],
          [1200, STICK, [7, 42], { 'axis:RZ': 0.4 }],
          [1320, STICK, [7], { 'axis:RZ': 0.7 }],
          [1360, STICK, [3, 7], { 'axis:RZ': 0.9 }],
        ],
        3000
      )
    ).toEqual(['1160 not counted button:41: too-quick', '1710 kept x missed', '1710 wrong x']);
    expect(round.session.wrongPress).toEqual({ guid: STICK, control: 'button:3' });
  });
});

describe('a switch that stays where it is put', () => {
  it('two-way: the position it is put in answers, and putting it back is not an answer', () => {
    // One button per position: Button 10 is held at rest, and 11 when it is flipped.
    const round = begin(
      [card('flip', on(THROTTLE, 11)), card('b', on(THROTTLE, 6))],
      [[0, THROTTLE, [10]]]
    );
    expect(
      play(
        round,
        [
          [1000, THROTTLE, [11]],
          [3000, THROTTLE, [10]],
          [4000, THROTTLE, [10, 6]],
          [4100, THROTTLE, [10]],
        ],
        8000
      )
    ).toEqual([
      '1350 kept flip right',
      '1350 right flip',
      '3300 asking b',
      '4300 kept b right',
      '4300 right b',
      '4950 done -',
      '4950 finished',
    ]);
    expect(round.session.results()).toMatchObject({ firstTry: 2, missed: [] });
  });

  // Three-way: Button 20 up, nothing in the middle, Button 21 down, where it rests.
  const threeWay = [card('up', on(THROTTLE, 20)), card('b', on(THROTTLE, 6))];

  it('three-way, put straight back: the next card waits until it is back', () => {
    const round = begin(threeWay, [[0, THROTTLE, [21]]]);
    expect(
      play(
        round,
        [
          [1000, THROTTLE, []],
          [1120, THROTTLE, [20]],
          [2500, THROTTLE, []],
          [2620, THROTTLE, [21]],
        ],
        8000
      )
    ).toEqual(['1470 kept up right', '1470 right up', '2920 asking b']);
    expect(round.note).toBeUndefined();
  });

  it('three-way, put back slowly: the next card waits for it, and the way back does not answer it', () => {
    // The card after "up" asks for the place the switch rests in.
    const round = begin(
      [card('up', on(THROTTLE, 20)), card('down', on(THROTTLE, 21))],
      [[0, THROTTLE, [21]]]
    );
    expect(
      play(
        round,
        [
          [1000, THROTTLE, []],
          [1120, THROTTLE, [20]],
          // Over half a second in the middle on the way back down.
          [2500, THROTTLE, []],
          [3100, THROTTLE, [21]],
        ],
        8000
      )
    ).toEqual(['1470 kept up right', '1470 right up', '3400 asking down']);
    // It is back where it rests, which is what the card asks: that is said, not counted.
    expect(round.session.phase).toBe('asking');
    expect(round.inPlace).toEqual([{ guid: THROTTLE, control: 'button:21' }]);
    expect(round.session.results()).toMatchObject({ firstTry: 1, missed: [] });
  });

  it('a lever with a button for each place, resting on the way back: the next card waits for it too', () => {
    // Button 30 where it rests, 31 half way, 32 at the far end. The next card asks for 30.
    const round = begin(
      [card('far', on(THROTTLE, 32)), card('home', on(THROTTLE, 30))],
      [[0, THROTTLE, [30]]]
    );
    expect(
      play(
        round,
        [
          [1000, THROTTLE, [31]],
          [1100, THROTTLE, [32]],
          // Back by way of the middle, with a rest there.
          [2500, THROTTLE, [31]],
          [3200, THROTTLE, [30]],
        ],
        8000
      )
    ).toEqual(['1450 kept far right', '1450 right far', '3500 asking home']);
    expect(round.session.phase).toBe('asking');
    expect(round.inPlace).toEqual([{ guid: THROTTLE, control: 'button:30' }]);
  });

  it('three-way, left in the middle: the next card comes after two seconds all the same', () => {
    const round = begin(threeWay, [[0, THROTTLE, [21]]]);
    expect(
      play(
        round,
        [
          [1000, THROTTLE, []],
          [1120, THROTTLE, [20]],
          [2500, THROTTLE, []],
        ],
        8000
      )
    ).toEqual(['1470 kept up right', '1470 right up', `${2500 + MAX_REST_MS} asking b`]);
    expect(round.note).toBeUndefined();
  });

  it('three-way, put back late: on the next card it is told and not counted', () => {
    const round = begin(threeWay, [[0, THROTTLE, [21]]]);
    expect(
      play(
        round,
        [
          [1000, THROTTLE, []],
          [1120, THROTTLE, [20]],
          // Left in the middle until the next card is up, then put back down.
          [2500, THROTTLE, []],
          [5000, THROTTLE, [21]],
        ],
        8000
      )
    ).toEqual([
      '1470 kept up right',
      '1470 right up',
      '4500 asking b',
      '5350 not counted button:21: back-to-rest',
    ]);
    expect(round.session.phase).toBe('asking');
    expect(round.session.results().missed).toEqual([]);
  });

  it('in place and asked for: moved away to let go of it, the next card does not wait for it', () => {
    // Button 11 is held when its card comes up. Away and back answers it; away again lets go.
    const round = begin(
      [card('flip', on(THROTTLE, 11)), card('b', on(THROTTLE, 6))],
      [[0, THROTTLE, [11]]]
    );
    expect(
      play(
        round,
        [
          [1000, THROTTLE, [10]],
          [1300, THROTTLE, [11]],
          [2500, THROTTLE, [10]],
        ],
        8000
      )
    ).toEqual(['1650 kept flip right', '1650 right flip', '2800 asking b']);
  });

  it('already where the card asks: answers when it is moved away and straight back', () => {
    const round = begin(
      [card('rest', on(THROTTLE, 10)), card('b', on(THROTTLE, 6))],
      [[0, THROTTLE, [10]]]
    );
    // Held since before the card, it is not an answer however long it stays. The round
    // knows that the control asked for is in place, so the card can say so.
    expect(play(round, [], 2999)).toEqual([]);
    expect(round.inPlace).toEqual([{ guid: THROTTLE, control: 'button:10' }]);
    // Moved away, it is in place no longer. Moved back, it is weighed like any press.
    expect(play(round, [[3000, THROTTLE, [11]]], 3100)).toEqual([]);
    expect(round.inPlace).toEqual([]);
    expect(play(round, [[3200, THROTTLE, [10]]], 3300)).toEqual([]);
    expect(round.inPlace).toEqual([]);
    expect(play(round, [], 3999)).toEqual(['3550 kept rest right', '3550 right rest']);
    expect(round.inPlace).toEqual([]);
    // The position it passed on the way there and back was not told.
    expect(round.note).toBeUndefined();
  });

  it('in place when its card comes up later, and still after a miss on that card', () => {
    // Button 10 is held all along. The first card is answered with Button 6.
    const round = begin(
      [card('b', on(THROTTLE, 6)), card('rest', on(THROTTLE, 10))],
      [[0, THROTTLE, [10]]]
    );
    const there = [{ guid: THROTTLE, control: 'button:10' }];
    expect(round.inPlace).toEqual([]);
    expect(
      play(
        round,
        [
          [1000, THROTTLE, [10, 6]],
          [1500, THROTTLE, [10]],
        ],
        2999
      )
    ).toEqual(['1350 kept b right', '1350 right b', '2000 asking rest']);
    expect(round.inPlace).toEqual(there);
    // Another control is taken for the answer: a miss. The control asked for is lit now,
    // and it is still where it was.
    expect(
      play(
        round,
        [
          [3000, THROTTLE, [10, 7]],
          [4000, THROTTLE, [10]],
        ],
        4400
      )
    ).toEqual(['3350 kept rest missed', '3350 wrong rest']);
    expect(round.inPlace).toEqual(there);
    expect(
      play(
        round,
        [
          [4500, THROTTLE, []],
          [4700, THROTTLE, [10]],
        ],
        5999
      )
    ).toEqual(['5050 corrected rest']);
    expect(round.inPlace).toEqual([]);
  });

  it('bound in two places with one of them in place: the other one answers', () => {
    const round = begin(
      [card('both', on(THROTTLE, 10), on(THROTTLE, 25)), card('b', on(THROTTLE, 6))],
      [[0, THROTTLE, [10]]]
    );
    expect(round.inPlace).toEqual([{ guid: THROTTLE, control: 'button:10' }]);
    expect(play(round, [[1000, THROTTLE, [10, 25]]], 1999)).toEqual([
      '1350 kept both right',
      '1350 right both',
    ]);
    expect(round.inPlace).toEqual([]);
  });
});

describe('a control let go too soon to count', () => {
  const deck = [card('a', on(THROTTLE, 5)), card('b', on(THROTTLE, 6))];
  const rest: Row[] = [[0, THROTTLE, []]];

  it('is not told when it is a position a lever only passes on its way', () => {
    // A lever passes Buttons 8 and 9 and stops where no button is.
    const round = begin(deck, rest);
    expect(
      play(
        round,
        [
          [1000, THROTTLE, [8]],
          [1080, THROTTLE, [9]],
          [1160, THROTTLE, []],
        ],
        2999
      )
    ).toEqual([]);
    expect(round.note).toBeUndefined();
    expect(round.session.phase).toBe('asking');
    expect(round.session.results().missed).toEqual([]);
  });

  it('is told when it is the control the card asks for, which counts once it is held', () => {
    // In a hurry: Button 9 is let go as Button 5 goes down, and 5 is let go at once.
    const round = begin(deck, rest);
    expect(
      play(
        round,
        [
          [1000, THROTTLE, [9]],
          [1080, THROTTLE, [5]],
          [1160, THROTTLE, []],
          [2000, THROTTLE, [5]],
        ],
        2999
      )
    ).toEqual(['1160 not counted button:5: too-quick', '2350 kept a right', '2350 right a']);
    expect(round.note).toBeUndefined();
  });

  it('after a miss, is told for the control that is lit and for no other', () => {
    const round = begin(deck, rest);
    expect(
      play(
        round,
        [
          [1000, THROTTLE, [9]],
          // Button 9 is let go as Button 8 goes down, 8 as 5 does, and 5 is let go at once.
          [2000, THROTTLE, [8]],
          [2080, THROTTLE, [5]],
          [2160, THROTTLE, []],
        ],
        2999
      )
    ).toEqual(['1350 kept a missed', '1350 wrong a', '2160 not counted button:5: too-quick']);
    expect(round.session.phase).toBe('wrong');
  });
});

describe('a hat', () => {
  const deck = [card('right', on(STICK, 'hat:1:R')), card('b', on(STICK, 9))];

  it('rolled over a corner, answers with the direction it ends on', () => {
    const round = begin(deck, [[0, STICK, []]]);
    expect(
      play(
        round,
        [
          [1000, STICK, ['hat:1:U']],
          [1060, STICK, ['hat:1:UR']],
          [1120, STICK, ['hat:1:R']],
        ],
        2000
      )
    ).toEqual(['1470 kept right right', '1470 right right']);
  });

  it('tapped, answers like a button', () => {
    const round = begin(deck, [[0, STICK, []]]);
    expect(
      play(
        round,
        [
          [1000, STICK, ['hat:1:R']],
          [1100, STICK, []],
        ],
        1500
      )
    ).toEqual(['1300 kept right right', '1300 right right']);
  });
});

describe('axes', () => {
  it('never answer, and their jitter neither spoils a tap nor holds up the next card', () => {
    const round = begin(two, [[0, THROTTLE, [], { 'axis:Z': 0.5 }]]);
    const jitter: Row[] = [];
    for (let at = 1200; at <= 2400; at += 100) {
      jitter.push([at, THROTTLE, [], { 'axis:Z': at % 200 === 0 ? 0.46 : 0.54 }]);
    }
    expect(
      play(
        round,
        [
          // An axis that moved is listed among what is held on a cheat sheet: not here.
          [900, THROTTLE, ['axis:Z'], { 'axis:Z': 0.53 }],
          [1000, THROTTLE, [5], { 'axis:Z': 0.47 }],
          [1040, THROTTLE, [5], { 'axis:Z': 0.52 }],
          [1090, THROTTLE, [], { 'axis:Z': 0.5 }],
          ...jitter,
        ],
        3000
      )
    ).toEqual(['1290 kept a right', '1290 right a', '1940 asking b']);
  });

  it('still travelling, hold the next card back until the lever is still', () => {
    const round = begin(two, [[0, THROTTLE, [], { 'axis:Z': 0.6 }]]);
    const travel: Row[] = [];
    for (let step = 0; step < 12; step++) {
      travel.push([1300 + step * 100, THROTTLE, [], { 'axis:Z': 0.5 - step * 0.1 }]);
    }
    expect(
      play(
        round,
        [
          [1000, THROTTLE, [5], { 'axis:Z': 0.6 }],
          [1090, THROTTLE, [], { 'axis:Z': 0.6 }],
          ...travel,
        ],
        5000
      )
    ).toEqual(['1290 kept a right', '1290 right a', '2700 asking b']);
  });

  it('that never come to rest cannot hold the next card back for ever', () => {
    const round = begin(two, [[0, THROTTLE, [], { 'axis:Z': 0.6 }]]);
    const restless: Row[] = [];
    for (let at = 1300; at <= 6000; at += 100) {
      restless.push([at, THROTTLE, [], { 'axis:Z': at % 200 === 0 ? 0.6 : 0.2 }]);
    }
    const log = play(
      round,
      [
        [1000, THROTTLE, [5], { 'axis:Z': 0.6 }],
        [1090, THROTTLE, [], { 'axis:Z': 0.6 }],
        ...restless,
      ],
      6000
    );
    expect(log).toEqual([
      '1290 kept a right',
      '1290 right a',
      `${1290 + SHOW_MS + MAX_REST_MS} asking b`,
    ]);
  });

  it('travelling under a button that is let go at once: too much going on for a tap; held, it counts', () => {
    const round = begin(two, [[0, THROTTLE, [], { 'axis:Z': 0.6 }]]);
    expect(
      play(
        round,
        [
          [1000, THROTTLE, [5], { 'axis:Z': 0.6 }],
          [1050, THROTTLE, [5], { 'axis:Z': 0.3 }],
          [1090, THROTTLE, [], { 'axis:Z': 0.1 }],
          [2000, THROTTLE, [5], { 'axis:Z': 0.1 }],
          [2100, THROTTLE, [5], { 'axis:Z': -0.4 }],
        ],
        2999
      )
    ).toEqual(['1090 not counted button:5: too-quick', '2350 kept a right', '2350 right a']);
  });
});

describe('what is held when a card comes up', () => {
  it('at the start of the round is where the controls rest, not an answer', () => {
    // The stick rests with Buttons 2 and 7 held; the card asks for what Button 2 does.
    const round = begin([card('x', on(STICK, 2)), card('y', on(STICK, 9))], [[0, STICK, [2, 7]]]);
    expect(play(round, [], 5000)).toEqual([]);
    // A controller that is heard for the first time in mid-round: the same.
    expect(play(round, [[6000, PANEL, [8]]], 9000)).toEqual([]);
    expect(round.session.phase).toBe('asking');
    expect(round.weighing).toBeUndefined();
  });

  it('after "Next" is where things rest too, and going back there is not an answer', () => {
    const round = begin(two, [[0, THROTTLE, []]]);
    expect(play(round, [[1000, THROTTLE, [9]]], 1499)).toEqual([
      '1350 kept a missed',
      '1350 wrong a',
    ]);
    // "Next" with the wrong control still down.
    expect(round.next()).toEqual({ verdicts: [], finished: false });
    expect(round.session.card!.id).toBe('b');
    expect(round.shown).toBe(2);
    expect(
      play(
        round,
        [
          [3000, THROTTLE, []],
          [3500, THROTTLE, [9]],
        ],
        5000
      )
    ).toEqual(['3850 not counted button:9: back-to-rest']);
    expect(round.session.phase).toBe('asking');
  });
});

describe('the card before', () => {
  it('cannot fail this one: a control used on it is told and not counted, once', () => {
    const round = begin([...two, card('c', on(THROTTLE, 7))], [[0, THROTTLE, []]]);
    expect(
      play(
        round,
        [
          // Card a: Button 9 is wrong, Button 5 is it.
          [1000, THROTTLE, [9]],
          [1100, THROTTLE, []],
          [2000, THROTTLE, [5]],
          [2100, THROTTLE, []],
          // Card b: Button 9 again. It was in use on the card before.
          [3500, THROTTLE, [9]],
          [3600, THROTTLE, []],
          [4500, THROTTLE, [6]],
          [4600, THROTTLE, []],
          // Card c: Button 9 once more is a press like any other.
          [6000, THROTTLE, [9]],
          [6100, THROTTLE, []],
        ],
        6999
      )
    ).toEqual([
      '1300 kept a missed',
      '1300 wrong a',
      '2300 corrected a',
      '2950 asking b',
      '3800 not counted button:9: last-card',
      '4800 kept b right',
      '4800 right b',
      '5450 asking c',
      '6300 kept c missed',
      '6300 wrong c',
    ]);
  });

  it('does not keep the right control from counting, even the one that answered it', () => {
    // Two actions on the same button.
    const round = begin(
      [card('a', on(THROTTLE, 5)), card('b', on(THROTTLE, 5))],
      [[0, THROTTLE, []]]
    );
    expect(
      play(
        round,
        [
          [1000, THROTTLE, [5]],
          [1090, THROTTLE, []],
          [2500, THROTTLE, [5]],
          [2590, THROTTLE, []],
        ],
        2999
      )
    ).toEqual([
      '1290 kept a right',
      '1290 right a',
      '1940 asking b',
      '2790 kept b right',
      '2790 right b',
    ]);
  });
});

describe('an action bound in two places', () => {
  it('is answered by either of them', () => {
    const deck = [
      card('elevation up', on(THROTTLE, 25), on(THROTTLE, 28)),
      card('b', on(THROTTLE, 6)),
    ];
    for (const button of [25, 28]) {
      const round = begin(deck, [[0, THROTTLE, []]]);
      expect(
        play(
          round,
          [
            [1000, THROTTLE, [button]],
            [1090, THROTTLE, []],
          ],
          1500
        )
      ).toEqual(['1290 kept elevation up right', '1290 right elevation up']);
      expect(round.session.answered).toMatchObject({ control: `button:${button}` });
    }
  });
});

describe('a round for one device', () => {
  const deck = [card('auto-throttle', on(THROTTLE, 50)), card('b', on(THROTTLE, 6))];
  const rest: Row[] = [
    [0, THROTTLE, []],
    [0, PANEL, []],
  ];

  it('says a press on another device is on another device, and does not count it', () => {
    const round = begin(deck, rest, [THROTTLE]);
    expect(play(round, [[1000, PANEL, [8]]], 2999)).toEqual([
      '1350 not counted button:8: other-device',
    ]);
    expect(round.note).toEqual({
      why: 'other-device',
      press: { guid: PANEL, control: 'button:8' },
    });
    expect(round.session.phase).toBe('asking');
    // No try was used: the right control is still right first time.
    expect(play(round, [[3000, THROTTLE, [50]]], 3999)).toEqual([
      '3350 kept auto-throttle right',
      '3350 right auto-throttle',
    ]);
    expect(round.note).toBeUndefined();
    expect(round.session.results()).toMatchObject({ firstTry: 1, missed: [] });
  });

  it('for all devices takes the same press for an answer', () => {
    const round = begin(deck, rest);
    expect(play(round, [[1000, PANEL, [8]]], 2999)).toEqual([
      '1350 kept auto-throttle missed',
      '1350 wrong auto-throttle',
    ]);
  });
});

describe('the sitting of 12 November 2026, played back', () => {
  // A round for the throttle. Times are the recording's, in milliseconds.
  it('76.4 s: Button 16 answered "Cage / uncage" and came on again on "Dispense flares"', () => {
    const round = begin(
      [card('Cage / uncage', on(THROTTLE, 16)), card('Dispense flares', on(THROTTLE, 24))],
      [[0, THROTTLE, [2]]],
      [THROTTLE]
    );
    expect(round.reveal(74_000).verdicts).toEqual([{ cardId: 'Cage / uncage', right: false }]);
    expect(
      play(
        round,
        [
          [74_950, THROTTLE, [2, 16]],
          [75_450, THROTTLE, [2]],
          // Half a second after the next card came up, Button 16 again.
          [76_400, THROTTLE, [2, 16]],
          [76_550, THROTTLE, [2]],
          [78_000, THROTTLE, [2, 24]],
        ],
        78_999
      )
    ).toEqual([
      '75300 corrected Cage / uncage',
      '75950 asking Dispense flares',
      '76750 not counted button:16: last-card',
      '78350 kept Dispense flares right',
      '78350 right Dispense flares',
    ]);
    // "Dispense flares" was not failed by the control of the card before.
    expect(round.session.results().missed.map((c) => c.id)).toEqual(['Cage / uncage']);
  });

  const handles = [
    card('Left throttle to IDLE', on(THROTTLE, 31)),
    card('Zoom in', on(THROTTLE, 42)),
  ];

  it('243.8 s: the left handle travelled back to OFF (Button 2) as "Zoom in" came up', () => {
    // Both handles rest at OFF: Buttons 1 and 2 are held.
    const round = begin(handles, [[0, THROTTLE, [1, 2]]], [THROTTLE]);
    round.reveal(240_000);
    expect(
      play(
        round,
        [
          // To the idle detent: off OFF, on to Button 31.
          [242_250, THROTTLE, [1]],
          [242_350, THROTTLE, [1, 31]],
          // And back: off the detent, and 90 ms later at OFF again.
          [243_700, THROTTLE, [1]],
          [243_790, THROTTLE, [1, 2]],
          [246_000, THROTTLE, [1, 2, 42]],
        ],
        246_999
      )
    ).toEqual([
      '242700 corrected Left throttle to IDLE',
      // The card waited for the handle to be back: Button 2 is where it rests.
      '244090 asking Zoom in',
      '246350 kept Zoom in right',
      '246350 right Zoom in',
    ]);
    expect(round.session.results().missed.map((c) => c.id)).toEqual(['Left throttle to IDLE']);
  });

  it('243.8 s, with a slower hand: "Zoom in" waits until the handle is at OFF again', () => {
    const round = begin(handles, [[0, THROTTLE, [1, 2]]], [THROTTLE]);
    round.reveal(240_000);
    expect(
      play(
        round,
        [
          [242_250, THROTTLE, [1]],
          [242_350, THROTTLE, [1, 31]],
          // Off the detent, and 600 ms on the way before it is at OFF.
          [243_700, THROTTLE, [1]],
          [244_300, THROTTLE, [1, 2]],
        ],
        249_999
      )
    ).toEqual(['242700 corrected Left throttle to IDLE', '244600 asking Zoom in']);
    expect(round.note).toBeUndefined();
  });

  it('243.8 s, with a slower hand and "Left throttle to OFF" next: the way back is not its answer', () => {
    const round = begin(
      [handles[0]!, card('Left throttle to OFF', on(THROTTLE, 2))],
      [[0, THROTTLE, [1, 2]]],
      [THROTTLE]
    );
    round.reveal(240_000);
    expect(
      play(
        round,
        [
          [242_250, THROTTLE, [1]],
          [242_350, THROTTLE, [1, 31]],
          [243_700, THROTTLE, [1]],
          [244_300, THROTTLE, [1, 2]],
        ],
        249_999
      )
    ).toEqual(['242700 corrected Left throttle to IDLE', '244600 asking Left throttle to OFF']);
    expect(round.session.phase).toBe('asking');
    expect(round.inPlace).toEqual([{ guid: THROTTLE, control: 'button:2' }]);
  });

  it('243.8 s, with a hand that takes over two seconds: back at OFF on the next card, it is told and not counted', () => {
    const round = begin(handles, [[0, THROTTLE, [1, 2]]], [THROTTLE]);
    round.reveal(240_000);
    expect(
      play(
        round,
        [
          [242_250, THROTTLE, [1]],
          [242_350, THROTTLE, [1, 31]],
          [243_700, THROTTLE, [1]],
          [246_500, THROTTLE, [1, 2]],
        ],
        249_999
      )
    ).toEqual([
      '242700 corrected Left throttle to IDLE',
      '245700 asking Zoom in',
      '246850 not counted button:2: back-to-rest',
    ]);
    expect(round.session.phase).toBe('asking');
  });

  it('239.8 s: the right handle, moved to OFF for one card, was parked there on the next', () => {
    // The right handle is not at OFF to begin with: only Button 2 (left OFF) is held.
    const round = begin(
      [card('Throttle (Right) - OFF', on(THROTTLE, 1)), handles[0]!],
      [[0, THROTTLE, [2]]],
      [THROTTLE]
    );
    expect(
      play(
        round,
        [
          [230_000, THROTTLE, [1, 2]],
          [231_900, THROTTLE, [2]],
          // Seven seconds into the next card it is put at OFF again, to stay.
          [239_800, THROTTLE, [1, 2]],
        ],
        249_999
      )
    ).toEqual([
      '230350 kept Throttle (Right) - OFF right',
      '230350 right Throttle (Right) - OFF',
      '232200 asking Left throttle to IDLE',
      '240150 not counted button:1: last-card',
    ]);
    expect(round.session.results().missed).toEqual([]);
  });

  it('207.5 s: a button brushed while a handle travels is not an answer', () => {
    const round = begin(
      [card('Throttle (Right) - OFF', on(THROTTLE, 1)), handles[0]!],
      [[0, THROTTLE, [2], { 'axis:RZ': 0.4 }]],
      [THROTTLE]
    );
    expect(
      play(
        round,
        [
          [207_300, THROTTLE, [2], { 'axis:RZ': 0.1 }],
          [207_500, THROTTLE, [2, 59], { 'axis:RZ': -0.3 }],
          [207_580, THROTTLE, [2], { 'axis:RZ': -0.6 }],
          [207_900, THROTTLE, [1, 2], { 'axis:RZ': -1 }],
        ],
        208_999
      )
    ).toEqual(['208250 kept Throttle (Right) - OFF right', '208250 right Throttle (Right) - OFF']);
  });

  it('176.1 s: Button 8 of the startup panel in the round for the throttle', () => {
    const round = begin(
      [card('Auto-throttle on/off', on(THROTTLE, 50)), handles[1]!],
      [
        [0, THROTTLE, [1, 2]],
        [0, PANEL, [3]],
      ],
      [THROTTLE]
    );
    // A switch of the panel is flipped: Button 3 off, Button 8 on, and it stays.
    expect(play(round, [[176_100, PANEL, [8]]], 179_999)).toEqual([
      '176450 not counted button:8: other-device',
    ]);
    expect(round.session.phase).toBe('asking');
    expect(round.session.results().missed).toEqual([]);
    // Put back: where it rested, on another device. Still nothing.
    expect(play(round, [[180_000, PANEL, [3]]], 181_999)).toEqual([
      '180350 not counted button:3: other-device',
    ]);
    expect(round.session.results().missed).toEqual([]);
  });
});

describe('the end of a round', () => {
  it('comes once, after the last card is answered and let go', () => {
    const round = begin([card('a', on(THROTTLE, 5))], [[0, THROTTLE, []]]);
    expect(
      play(
        round,
        [
          [1000, THROTTLE, [5]],
          [1090, THROTTLE, []],
        ],
        5000
      )
    ).toEqual(['1290 kept a right', '1290 right a', '1940 done -', '1940 finished']);
    expect(round.due()).toBeUndefined();
    // Nothing more happens, whatever is pressed.
    expect(play(round, [[6000, THROTTLE, [5]]], 9000)).toEqual([]);
    expect(round.next()).toEqual({ verdicts: [], finished: false });
    expect(round.reveal(9500)).toEqual({ verdicts: [], finished: false });
  });

  it('has nothing to ask without cards', () => {
    const round = begin([], [[0, THROTTLE, []]]);
    expect(round.session.phase).toBe('done');
    expect(play(round, [[1000, THROTTLE, [5]]], 3000)).toEqual([]);
  });
});
