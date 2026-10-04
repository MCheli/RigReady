import { describe, expect, it } from 'vitest';
import type { Sheet, SheetBinding, SheetControl, SheetDevice } from './sheet';
import {
  EMPTY_PROGRESS,
  LEARNED_STREAK,
  pickDeck,
  recordAnswer,
  seededRandom,
  summarize,
  trainerCards,
  TrainerSession,
  type AircraftProgress,
  type TrainerCard,
} from './trainer';

const binding = (action: string, over: Partial<SheetBinding> = {}): SheetBinding => ({
  actionId: `id:${action}`,
  action,
  short: action,
  modifiers: [],
  category: [],
  kind: 'weapons',
  source: 'user',
  alsoOn: [],
  ...over,
});
const control = (id: string, ...bindings: SheetBinding[]): SheetControl => ({
  id,
  name: id,
  bindings,
  conflict: false,
});
const device = (key: string, guid: string | undefined, controls: SheetControl[]): SheetDevice =>
  ({
    key,
    ...(guid ? { guid } : {}),
    name: key,
    title: key,
    connected: guid !== undefined,
    controls,
    other: [],
    counts: { placed: 0, bound: 0, empty: 0, conflicts: 0, hidden: 0 },
    route: '/',
  }) as unknown as SheetDevice;
const sheetOf = (...devices: SheetDevice[]): Sheet => ({
  game: 'dcs',
  gameName: 'DCS World',
  aircraft: { id: 'FA-18C_hornet', name: 'F/A-18C', hasUserBindings: true },
  devices,
});

const stick = device('Stick', 'aaaa-1', [
  control('button:20', binding('Weapon Release')),
  control('button:5', binding('Trim Up', { kind: 'flight' })),
  control('hat:1:U', binding('Sensor Control Switch - Fwd', { kind: 'sensors' })),
  control('axis:X', binding('Roll', { kind: 'flight' })),
  control('button:2', binding('Nose Wheel Steering', { modifiers: ['Paddle'] })),
  control('button:9', binding('View Center', { source: 'default', kind: 'view' })),
]);
const throttle = device('Throttle', 'BBBB-2', [
  control('button:3', binding('Speed Brake', { kind: 'airframe' })),
  control('button:7', binding('Weapon Release')),
]);
const unplugged = device('Panel', undefined, [control('button:1', binding('Master Arm'))]);

describe('which actions make cards', () => {
  it('asks every action a button or hat of a connected controller does by itself', () => {
    const cards = trainerCards(sheetOf(stick, throttle, unplugged));
    expect(cards.map((c) => c.action)).toEqual([
      'Weapon Release',
      'Trim Up',
      'Sensor Control Switch - Fwd',
      'Speed Brake',
    ]);
    // Not an axis, not a press that needs a modifier, not a device that is not attached,
    // and not what the game binds by default when the user has bindings of their own.
    const actions = cards.map((c) => c.action).join(' ');
    for (const left of ['Roll', 'Nose Wheel Steering', 'Master Arm', 'View Center']) {
      expect(actions).not.toContain(left);
    }
  });

  it('accepts every control that does the action, and names each as the page will', () => {
    const release = trainerCards(sheetOf(stick, throttle))[0]!;
    expect(release.answers).toEqual([
      {
        deviceKey: 'Stick',
        guid: 'AAAA-1',
        device: 'Stick',
        control: 'button:20',
        name: 'Button 20',
      },
      {
        deviceKey: 'Throttle',
        guid: 'BBBB-2',
        device: 'Throttle',
        control: 'button:7',
        name: 'Button 7',
      },
    ]);
    const hat = trainerCards(sheetOf(stick)).find((c) => c.kind === 'sensors')!;
    expect(hat.answers[0]!.name).toBe('Hat 1 up');
  });

  it('asks the game defaults when the user has no bindings of their own', () => {
    const defaults = device('Stick', 'G', [
      control('button:9', binding('View Center', { source: 'default' })),
    ]);
    expect(trainerCards(sheetOf(defaults)).map((c) => c.action)).toEqual(['View Center']);
    expect(trainerCards(sheetOf())).toEqual([]);
  });

  it('shows a plainer wording first when one is known, and never the same words twice', () => {
    const cards = trainerCards(sheetOf(stick), {
      'Sensor Control Switch - Fwd': 'Sensor select: HUD',
      'Trim Up': 'Trim Up',
    });
    expect(cards.find((c) => c.action === 'Sensor Control Switch - Fwd')!.plain).toBe(
      'Sensor select: HUD'
    );
    expect(cards.find((c) => c.action === 'Trim Up')!.plain).toBeUndefined();
  });
});

const card = (id: string, deviceKey = 'Stick', guid = 'G1', button = 1): TrainerCard => ({
  id,
  action: id,
  kind: 'other',
  answers: [{ deviceKey, guid, device: deviceKey, control: `button:${button}`, name: 'Button' }],
});
const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => card(id, 'Stick', 'G1', i + 1));
const press = (button: number, guid = 'G1') => ({ guid, control: `button:${button}` });

describe('what is remembered', () => {
  it('counts right and wrong per action, and a miss ends the run of right answers', () => {
    let progress = EMPTY_PROGRESS;
    progress = recordAnswer(progress, 'a', true, 't1');
    progress = recordAnswer(progress, 'a', true, 't2');
    progress = recordAnswer(progress, 'b', false, 't3');
    expect(progress.cards).toEqual({
      a: { right: 2, wrong: 0, streak: 2, last: 't2' },
      b: { right: 0, wrong: 1, streak: 0, last: 't3' },
    });
    expect(progress.lastPlayed).toBe('t3');
    progress = recordAnswer(progress, 'a', false, 't4');
    expect(progress.cards['a']).toEqual({ right: 2, wrong: 1, streak: 0, last: 't4' });
    // The record it was given is left as it was.
    expect(EMPTY_PROGRESS).toEqual({ rounds: 0, cards: {} });
  });

  it('calls an action learned once it was right first time twice running', () => {
    expect(LEARNED_STREAK).toBe(2);
    let progress: AircraftProgress = { rounds: 3, cards: {} };
    progress = recordAnswer(progress, 'a', true, 't');
    progress = recordAnswer(progress, 'b', true, 't');
    progress = recordAnswer(progress, 'b', true, 't');
    progress = recordAnswer(progress, 'gone', true, 't');
    progress = recordAnswer(progress, 'gone', true, 't');
    // "gone" is an action that is no longer bound: it does not count either way.
    expect(summarize(six, progress)).toEqual({ total: 6, seen: 2, learned: 1, rounds: 3 });
    expect(summarize([], progress)).toEqual({ total: 0, seen: 0, learned: 0, rounds: 3 });
  });
});

describe('the cards of a round', () => {
  it('gives the same round for the same seed, and another for another', () => {
    const a = pickDeck(six, EMPTY_PROGRESS, { size: 6, random: seededRandom(7) });
    const b = pickDeck(six, EMPTY_PROGRESS, { size: 6, random: seededRandom(7) });
    const c = pickDeck(six, EMPTY_PROGRESS, { size: 6, random: seededRandom(8) });
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(a.map((x) => x.id)).not.toEqual(c.map((x) => x.id));
    expect([...a.map((x) => x.id)].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    const random = seededRandom(1);
    for (let i = 0; i < 50; i++) {
      const n = random();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });

  it('asks what needs it most: never asked, then missed, then right once, then learned', () => {
    let progress = EMPTY_PROGRESS;
    progress = recordAnswer(progress, 'a', true, 't');
    progress = recordAnswer(progress, 'a', true, 't');
    progress = recordAnswer(progress, 'b', true, 't');
    progress = recordAnswer(progress, 'c', false, 't');
    for (let seed = 1; seed <= 20; seed++) {
      const random = seededRandom(seed);
      // d, e, f were never asked; c was missed; b is right once; a is learned.
      expect(
        pickDeck(six, progress, { size: 3, random })
          .map((x) => x.id)
          .sort()
      ).toEqual(['d', 'e', 'f']);
      expect(
        pickDeck(six, progress, { size: 4, random })
          .map((x) => x.id)
          .sort()
      ).toEqual(['c', 'd', 'e', 'f']);
      expect(pickDeck(six, progress, { size: 5, random }).map((x) => x.id)).not.toContain('a');
    }
    expect(pickDeck(six, progress, { size: 0, random: seededRandom(1) })).toHaveLength(1);
  });

  it('can be limited to one device, or to the cards missed last time', () => {
    const both: TrainerCard = {
      ...card('both'),
      answers: [...card('x', 'Stick').answers, ...card('y', 'Throttle', 'G2', 4).answers],
    };
    const cards = [card('stick-only'), card('throttle-only', 'Throttle', 'G2', 9), both];
    const onThrottle = pickDeck(cards, EMPTY_PROGRESS, {
      size: 10,
      random: seededRandom(1),
      deviceKey: 'Throttle',
    });
    expect(onThrottle.map((c) => c.id).sort()).toEqual(['both', 'throttle-only']);
    // On that device only its own control is a right answer.
    expect(onThrottle.find((c) => c.id === 'both')!.answers.map((a) => a.deviceKey)).toEqual([
      'Throttle',
    ]);
    const again = pickDeck(cards, EMPTY_PROGRESS, {
      size: 10,
      random: seededRandom(1),
      only: ['both'],
    });
    expect(again.map((c) => c.id)).toEqual(['both']);
  });
});

describe('a round', () => {
  it('is right when any control of the action is pressed, at once, and moves on when told', () => {
    const session = new TrainerSession(six.slice(0, 2));
    expect(session.phase).toBe('asking');
    expect(session.card!.id).toBe('a');
    expect(session.canAdvance).toBe(false);
    // Lower-case GUIDs are the same controller.
    expect(session.press({ guid: 'g1', control: 'button:1' })).toEqual({
      cardId: 'a',
      right: true,
    });
    expect(session.phase).toBe('right');
    expect(session.answered).toMatchObject({ control: 'button:1' });
    expect(session.settled).toBe(1);
    // More presses while it shows "right" change nothing.
    expect(session.press(press(5))).toBeUndefined();
    expect(session.phase).toBe('right');
    session.advance();
    expect(session.card!.id).toBe('b');
    expect(session.phase).toBe('asking');
    expect(session.answered).toBeUndefined();
    expect(session.press(press(2))).toEqual({ cardId: 'b', right: true });
    session.advance();
    expect(session.phase).toBe('done');
    expect(session.card).toBeUndefined();
    expect(session.press(press(1))).toBeUndefined();
    expect(session.results()).toEqual({ asked: 2, firstTry: 2, missed: [] });
    expect(session.settled).toBe(2);
    expect(session.total).toBe(2);
  });

  it('is wrong at once for another control, shows what was pressed, and waits for the right one', () => {
    const session = new TrainerSession(six.slice(0, 2));
    expect(session.press(press(6))).toEqual({ cardId: 'a', right: false });
    expect(session.phase).toBe('wrong');
    expect(session.wrongPress).toEqual({ guid: 'G1', control: 'button:6' });
    expect(session.comesBack).toBe(true);
    expect(session.settled).toBe(0);
    // Another wrong press is not a second miss.
    expect(session.press(press(4))).toBeUndefined();
    expect(session.phase).toBe('wrong');
    // The right control on another controller is not it either.
    expect(session.press(press(1, 'G2'))).toBeUndefined();
    expect(session.press(press(1))).toBeUndefined();
    expect(session.phase).toBe('corrected');
    expect(session.answered).toMatchObject({ control: 'button:1' });
    expect(session.canAdvance).toBe(true);
    session.advance();
    expect(session.wrongPress).toBeUndefined();
    expect(session.card!.id).toBe('b');
  });

  it('brings a missed card back a few cards later, and right then does not count as known', () => {
    const session = new TrainerSession(six);
    const verdicts = [session.press(press(6))];
    session.press(press(1));
    session.advance();
    const asked = ['a'];
    while (session.phase !== 'done') {
      const now = session.card!;
      asked.push(now.id);
      verdicts.push(session.press(now.answers[0]!));
      session.advance();
    }
    // a was missed, then b, c, d were asked, then a again, then the rest.
    expect(asked).toEqual(['a', 'b', 'c', 'd', 'a', 'e', 'f']);
    expect(verdicts).toEqual([
      { cardId: 'a', right: false },
      { cardId: 'b', right: true },
      { cardId: 'c', right: true },
      { cardId: 'd', right: true },
      undefined,
      { cardId: 'e', right: true },
      { cardId: 'f', right: true },
    ]);
    expect(session.results()).toEqual({ asked: 6, firstTry: 5, missed: [six[0]] });
    expect(session.settled).toBe(6);
  });

  it('gives the answer away when asked to, which is a miss', () => {
    const session = new TrainerSession(six.slice(0, 1));
    expect(session.reveal()).toEqual({ cardId: 'a', right: false });
    expect(session.phase).toBe('shown');
    expect(session.reveal()).toBeUndefined();
    expect(session.canAdvance).toBe(true);
    // Pressing it now is practice, not knowledge.
    expect(session.press(press(1))).toBeUndefined();
    expect(session.phase).toBe('corrected');
    session.advance();
    // It is the only card, so it comes straight back.
    expect(session.card!.id).toBe('a');
    expect(session.press(press(1))).toBeUndefined();
    expect(session.phase).toBe('right');
    session.advance();
    expect(session.phase).toBe('done');
    expect(session.results()).toEqual({ asked: 1, firstTry: 0, missed: [six[0]] });
  });

  it('stops asking a card that keeps being missed after three times', () => {
    const session = new TrainerSession(six.slice(0, 1));
    const verdicts = [];
    for (let ask = 1; ask <= 3; ask++) {
      expect(session.card!.id).toBe('a');
      verdicts.push(session.press(press(6)));
      expect(session.comesBack).toBe(ask < 3);
      session.advance();
    }
    expect(session.phase).toBe('done');
    expect(verdicts).toEqual([
      { cardId: 'a', right: false },
      { cardId: 'a', right: false },
      { cardId: 'a', right: false },
    ]);
    expect(session.settled).toBe(1);
    session.advance();
    expect(session.phase).toBe('done');
  });

  it('has nothing to ask without cards', () => {
    const session = new TrainerSession([]);
    expect(session.phase).toBe('done');
    expect(session.card).toBeUndefined();
    expect(session.comesBack).toBe(false);
    expect(session.reveal()).toBeUndefined();
    expect(session.results()).toEqual({ asked: 0, firstTry: 0, missed: [] });
  });
});
