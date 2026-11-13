import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, screensDir, test, type RunningApp } from './harness';
import { HOLD_MS } from '../../src/features/cheat-sheets/core/trainerRound';

/**
 * "Learn your controls": RigReady names an action of the F/A-18C, the control is pressed
 * on the (fake) device as a hand would press it, and the page says right or wrong once the
 * control has been held for a moment or tapped.
 *
 * The controllers are played as they report: a state says everything that is held, so a
 * lever that leaves one position for another is one state after the other.
 */

interface Controller {
  index: number;
  name: string;
  guid: string;
  numAxes: number;
  numButtons: number;
  numHats: number;
}
interface Answer {
  deviceKey: string;
  guid: string;
  device: string;
  control: string;
  name: string;
}
interface Card {
  id: string;
  action: string;
  plain?: string;
  answers: Answer[];
}
interface Deck {
  cards: Card[];
  devices: { key: string; title: string }[];
}
interface Progress {
  rounds: number;
  cards: Record<string, { right: number; wrong: number; streak: number }>;
}

const HORNET = { game: 'dcs', aircraftId: 'FA-18C_hornet' };

/** Calls the app's own IPC from the page, as a screen does. */
async function invoke<T>(page: Page, channel: string, input?: unknown): Promise<T> {
  const answer = (await page.evaluate(
    ([name, payload]) =>
      (
        globalThis as unknown as {
          rigready: { invoke(channel: string, input: unknown): Promise<unknown> };
        }
      ).rigready.invoke(name as string, payload),
    [channel, input] as const
  )) as { ok: boolean; value?: T; error?: { message: string } };
  if (!answer.ok) throw new Error(answer.error?.message ?? 'failed');
  return answer.value as T;
}

const HAT: Record<string, [number, number]> = {
  U: [0, 1],
  UR: [1, 1],
  R: [1, 0],
  DR: [1, -1],
  D: [0, -1],
  DL: [-1, -1],
  L: [-1, 0],
  UL: [-1, 1],
};

let clock = 9_000;
/** A controller with the given controls held (button:12, hat:1:U) and everything else at rest. */
function stateOf(c: Controller, held: string[] = []) {
  return {
    index: c.index,
    name: c.name,
    axes: Array.from({ length: c.numAxes }, () => 0),
    buttons: Array.from({ length: c.numButtons }, (_, i) => held.includes(`button:${i + 1}`)),
    hats: Array.from({ length: c.numHats }, (_, i): [number, number] => {
      const on = held.find((id) => id.startsWith(`hat:${i + 1}:`));
      return on ? (HAT[on.split(':')[2]!] ?? [0, 0]) : [0, 0];
    }),
    timestamp: clock++,
  };
}

/** "A", "A or B", "A, B or C". */
const either = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;

/** "Button 12" for button:12, as the page names it. */
const buttonName = (control: string): string => `Button ${control.split(':')[1]}`;

async function openSheets(page: Page): Promise<void> {
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-cheat-sheets').click();
  await expect(page.getByTestId('sheet-view').first()).toBeVisible();
}

/** From the cheat sheet of the aircraft to its trainer, with a round for one device chosen. */
async function openTrainer(page: Page, device?: string): Promise<Locator> {
  await openSheets(page);
  await page.getByTestId('sheet-learn').click();
  const trainer = page.getByTestId('trainer-page');
  if (device) {
    await trainer.getByTestId('trainer-device').click();
    await page.getByRole('option', { name: new RegExp(`^${device} · `) }).click();
  }
  return trainer;
}

/** The fake rig of the F/A-18C as the trainer sees it: its controllers and its cards. */
async function hornet(page: Page) {
  const controllers = await invoke<Controller[]>(page, 'devices:inputDevices');
  const deck = await invoke<Deck>(page, 'cheat-sheets:trainerDeck', HORNET);
  const controllerOf = (guid: string): Controller =>
    controllers.find((c) => c.guid.toUpperCase() === guid.toUpperCase())!;
  const keyOf = (title: string): string => deck.devices.find((d) => d.title === title)!.key;
  /** The cards that can be answered on a device. */
  const cardsOn = (deviceKey: string): Card[] =>
    deck.cards.filter((c) => c.answers.some((a) => a.deviceKey === deviceKey));
  /** The controller a device of the sheet is. */
  const controllerFor = (deviceKey: string): Controller =>
    controllerOf(cardsOn(deviceKey)[0]!.answers.find((a) => a.deviceKey === deviceKey)!.guid);
  /** A button of the controller that no card asks for. */
  const spare = (controller: Controller): string => {
    const asked = new Set(
      deck.cards
        .flatMap((c) => c.answers)
        .filter((a) => a.guid.toUpperCase() === controller.guid.toUpperCase())
        .map((a) => a.control)
    );
    const free = Array.from({ length: controller.numButtons }, (_, i) => `button:${i + 1}`).find(
      (control) => !asked.has(control)
    );
    if (!free) throw new Error(`Every button of ${controller.name} is on a card.`);
    return free;
  };
  return { controllers, deck, controllerOf, keyOf, cardsOn, controllerFor, spare };
}
type Hornet = Awaited<ReturnType<typeof hornet>>;

/**
 * The page listens, and has been told where the controls of this many controllers are.
 * A round takes what a controller says first for where its controls rest, so a round is
 * started only after that has arrived.
 */
async function heard(trainer: Locator, controllers: number): Promise<void> {
  await expect(trainer).toHaveAttribute('data-live', 'true');
  await expect(trainer).toHaveAttribute('data-heard', String(controllers));
}

/** A control of a picture is lit as right, as wrong or as "it is this one". */
const lit = (picture: Locator, control: string, as: 'right' | 'wrong' | 'target') =>
  expect(picture.locator(`.cs-ctl[data-control="${control}"]`)).toHaveClass(new RegExp(`tr-${as}`));

/** What the trainer keeps under the data root for one aircraft (or a game's one set). */
async function kept(run: RunningApp, aircraft = 'dcs/FA-18C_hornet'): Promise<Progress> {
  const file = path.join(run.dataRoot, 'cheat-sheets', 'trainer.json');
  const all = JSON.parse(await fs.readFile(file, 'utf8')) as { aircraft: Record<string, Progress> };
  return all.aircraft[aircraft] ?? { rounds: 0, cards: {} };
}

interface Asked {
  card: Card;
  /** Where the card can be answered in this round. */
  places: Answer[];
  /** The first of them. */
  answer: Answer;
  ask: string;
}

/** A round on screen and the hands that play it. `deviceKey` is the device the round is for. */
function roundOf(run: RunningApp, fake: Hornet, deviceKey?: string) {
  const trainer = run.page.getByTestId('trainer-page');
  const card = trainer.getByTestId('trainer-card');
  const count = card.getByTestId('trainer-count');
  const verdict = trainer.getByTestId('trainer-verdict');
  const note = trainer.getByTestId('trainer-note');
  const summary = trainer.getByTestId('trainer-summary');

  /** The card whose question is open. */
  const current = async (): Promise<Asked> => {
    await expect(verdict).toHaveAttribute('data-phase', 'asking');
    const id = await card.getAttribute('data-card-id');
    const found = fake.deck.cards.find((c) => c.id === id)!;
    const places = found.answers.filter((a) => !deviceKey || a.deviceKey === deviceKey);
    return {
      card: found,
      places,
      answer: places[0]!,
      ask: (await card.getAttribute('data-ask')) ?? '',
    };
  };
  /** The next card once its question is open; nothing when the round is over. */
  const turn = async (): Promise<Asked | undefined> => {
    await expect(
      trainer.locator(
        '[data-testid="trainer-verdict"][data-phase="asking"], [data-testid="trainer-summary"]'
      )
    ).toBeVisible();
    return (await summary.count()) > 0 ? undefined : current();
  };
  /** The card on screen has been replaced by the next one, or the round is over. */
  const movedOn = (ask: string) =>
    expect(
      trainer.locator(
        `[data-testid="trainer-card"]:not([data-ask="${ask}"]), [data-testid="trainer-summary"]`
      )
    ).toBeVisible();
  /** A control goes down. `parked` are controls of its controller that stay where they are. */
  const hold = (a: Answer, parked: string[] = []) =>
    run.sendInput([stateOf(fake.controllerOf(a.guid), [...parked, a.control])]);
  const letGo = (a: Answer, parked: string[] = []) =>
    run.sendInput([stateOf(fake.controllerOf(a.guid), parked)]);
  /** Answers every card right until the round is over; says which cards were asked. */
  const finish = async (parked: string[] = []): Promise<string[]> => {
    const asked: string[] = [];
    for (;;) {
      const now = await turn();
      if (!now) return asked;
      asked.push(now.card.id);
      await hold(now.answer, parked);
      await expect(verdict).toHaveAttribute('data-phase', 'right');
      await letGo(now.answer, parked);
      await movedOn(now.ask);
    }
  };
  return { card, count, verdict, note, summary, current, turn, movedOn, hold, letGo, finish };
}

test('trainer: an action is named, the control is pressed on the device, right or wrong is said once it is held, missed cards come back, and what is learned is kept', async ({
  rig,
}) => {
  test.setTimeout(240_000);
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-trainer');
  const { page, shot } = run;
  await openSheets(page);

  // From the cheat sheet of the aircraft to its trainer.
  await page.getByTestId('sheet-learn').click();
  const trainer = page.getByTestId('trainer-page');
  await expect(trainer.locator('h1')).toHaveText('Learn your controls');
  await expect(trainer.getByTestId('trainer-aircraft')).toContainText('F/A-18C');

  const fake = await hornet(page);
  const { deck } = fake;
  const stickKey = fake.keyOf('Stick');
  const onStick = fake.cardsOn(stickKey);

  // Only the stick, for a start: twenty controls to know.
  await expect(trainer.getByTestId('trainer-intro')).toContainText(
    `${deck.cards.length} controls to know in F/A-18C`
  );
  await trainer.getByTestId('trainer-device').click();
  await page.getByRole('option', { name: /^Stick · / }).click();
  await expect(trainer.getByTestId('trainer-intro')).toContainText(
    `${onStick.length} controls to know in F/A-18C`
  );
  await expect(trainer.getByTestId('trainer-progress')).toContainText(
    `0 of ${onStick.length} learned`
  );
  await shot('before-a-round');

  // The stick says where its controls rest; from then on a control that goes down and stays
  // down for a moment is a press.
  await run.sendInput([stateOf(fake.controllerFor(stickKey))]);
  await heard(trainer, 1);
  await trainer.getByTestId('trainer-start').click();

  const round = roundOf(run, fake, stickKey);
  const { card, count, verdict, summary, current, movedOn, hold, letGo, finish } = round;
  const picture = trainer.getByTestId('trainer-picture');
  const controls = (asked: Asked): string[] => asked.places.map((p) => p.control);
  const where = (asked: Asked): string => `${either(asked.places.map((p) => p.name))} on Stick`;

  // ---- Card 1: the right control. Held for a moment it is right, and every control of the
  // stick that does the action is lit on the picture; letting go moves on.
  await expect(count).toHaveText('0 of 10 done');
  const first = await current();
  await expect(card.getByTestId('trainer-action')).toHaveText(
    first.card.plain ?? first.card.action
  );
  if (first.card.plain) {
    // The game's own name is beside the plain wording.
    await expect(card.getByTestId('trainer-game-name')).toContainText(first.card.action);
  }
  await expect(verdict).toContainText('Press the control for it on Stick');
  // Nothing is written on the picture while the question is open.
  await expect(picture.locator('.cs-ctl.cs-bound')).toHaveCount(0);
  await shot('asking');
  await hold(first.answer);
  await expect(verdict).toHaveAttribute('data-phase', 'right');
  await expect(verdict).toContainText(`Right. ${first.answer.name} on Stick`);
  await expect(verdict).toContainText('Let go of it for the next card');
  await expect(picture).toHaveAttribute('data-right', controls(first).join(' '));
  for (const control of controls(first)) await lit(picture, control, 'right');
  await expect(count).toHaveText('1 of 10 done');
  await shot('right');
  await letGo(first.answer);
  await movedOn(first.ask);

  // ---- Card 2: another control. Held, it is wrong: what was pressed and what it does, and
  // the right one lit. Pressing that goes on, and the card will come back.
  const second = await current();
  // A control of the stick that does something else. Not the one that answered the card
  // before: that one would be told and not counted.
  const other = onStick.find(
    (c) =>
      c.id !== second.card.id &&
      c.id !== first.card.id &&
      !c.answers.some((a) => second.card.answers.some((b) => b.control === a.control))
  )!;
  const mistake = other.answers.find((a) => a.deviceKey === stickKey)!;
  await hold(mistake);
  await expect(verdict).toHaveAttribute('data-phase', 'wrong');
  await expect(verdict).toContainText(`Not that one. You pressed ${mistake.name} on Stick`);
  // What the wrong control does is named as its own card would name it.
  await expect(verdict).toContainText(`which is ${other.plain ?? other.action}`);
  await expect(verdict).toContainText(`It is ${where(second)}`);
  await lit(picture, mistake.control, 'wrong');
  for (const control of controls(second)) await lit(picture, control, 'target');
  await expect(count).toHaveText('1 of 10 done');
  // Right, wrong and "it is this one" are said in words and icons, not by colour alone.
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('wrong');
  await letGo(mistake);
  await expect(verdict).toHaveAttribute('data-phase', 'wrong');
  await hold(second.answer);
  await expect(verdict).toHaveAttribute('data-phase', 'corrected');
  await expect(verdict).toContainText('This one comes back later in the round');
  for (const control of controls(second)) await lit(picture, control, 'right');
  await letGo(second.answer);
  await movedOn(second.ask);

  // ---- Card 3: "Show me" gives it away, which is a miss too.
  const third = await current();
  await trainer.getByTestId('trainer-show').click();
  await expect(verdict).toHaveAttribute('data-phase', 'shown');
  await expect(verdict).toContainText(`It is ${where(third)}`);
  for (const control of controls(third)) await lit(picture, control, 'target');
  await shot('shown');
  await hold(third.answer);
  await expect(verdict).toHaveAttribute('data-phase', 'corrected');
  await letGo(third.answer);
  await movedOn(third.ask);

  // ---- The rest of the round, all right. The two missed cards come back in it.
  const rest = await finish();
  expect(rest).toContain(second.card.id);
  expect(rest).toContain(third.card.id);
  expect(rest).toHaveLength(9);
  await expect(summary.getByTestId('trainer-score')).toHaveText('8 of 10 right first time');
  const missed = summary.getByTestId('trainer-missed');
  await expect(missed.locator('li')).toHaveCount(2);
  await expect(missed).toContainText(second.card.plain ?? second.card.action);
  await expect(missed).toContainText(where(second));
  await expect(missed).toContainText(third.card.plain ?? third.card.action);
  await expect(trainer.getByTestId('trainer-progress')).toContainText('1 round played');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('round-over');

  // What was answered is kept under the data root, per aircraft.
  await expect.poll(async () => (await kept(run)).rounds).toBe(1);
  let progress = await kept(run);
  expect(Object.keys(progress.cards)).toHaveLength(10);
  expect(progress.cards[first.card.id]).toMatchObject({ right: 1, wrong: 0, streak: 1 });
  expect(progress.cards[second.card.id]).toMatchObject({ right: 0, wrong: 1, streak: 0 });
  expect(progress.cards[third.card.id]).toMatchObject({ right: 0, wrong: 1, streak: 0 });

  // ---- A device is taken out while the summary is up. The cards behind it are read again:
  // the list to practise loses the device. The summary, with what was missed, stays.
  await run.mutate([{ op: 'unplugDevice', match: { vendorId: '4098', productId: 'BEDE' } }]);
  await trainer.getByTestId('trainer-device').click();
  await expect(page.getByRole('option', { name: /^Stick · / })).toBeVisible();
  await expect(page.getByRole('option', { name: /UFC1/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('option', { name: /^Stick · / })).toHaveCount(0);
  await expect(summary.getByTestId('trainer-score')).toHaveText('8 of 10 right first time');
  await expect(missed.locator('li')).toHaveCount(2);

  // ---- "Practise the missed": a round of just those two.
  await summary.getByTestId('trainer-again-missed').click();
  await expect(count).toHaveText('0 of 2 done');
  const again = await finish();
  expect([...again].sort()).toEqual([second.card.id, third.card.id].sort());
  await expect(summary.getByTestId('trainer-score')).toHaveText('2 of 2 right first time');
  await expect(summary.getByTestId('trainer-missed')).toHaveCount(0);

  // ---- Two more rounds: the ten not asked yet, then ten again. Right first time twice
  // running is learned.
  await summary.getByTestId('trainer-again').click();
  const unseen = await finish();
  expect(unseen.filter((id) => id in progress.cards)).toEqual([]);
  await expect(summary.getByTestId('trainer-score')).toHaveText('10 of 10 right first time');
  await expect(trainer.getByTestId('trainer-progress')).toContainText(
    `0 of ${onStick.length} learned`
  );
  await summary.getByTestId('trainer-again').click();
  await finish();
  await expect(trainer.getByTestId('trainer-progress')).toContainText(
    `10 of ${onStick.length} learned`
  );
  await expect(trainer.getByTestId('trainer-progress')).toContainText('4 rounds played');
  await expect.poll(async () => (await kept(run)).rounds).toBe(4);
  progress = await kept(run);
  expect(Object.values(progress.cards).filter((c) => c.streak >= 2)).toHaveLength(10);
  await shot('learned');

  // ---- It is still there after a restart.
  const restarted: RunningApp = await run.restart();
  const back = await openTrainer(restarted.page, 'Stick');
  await expect(back.getByTestId('trainer-progress')).toContainText(
    `10 of ${onStick.length} learned`
  );
  await expect(back.getByTestId('trainer-progress')).toContainText('4 rounds played');
  await restarted.shot('after-restart');
});

test('trainer: only a control that is held or tapped answers a card; one on its way back, one from the card before, one on another device and the right one let go too soon are said and not counted; a position that is only passed is not said', async ({
  rig,
}) => {
  test.setTimeout(180_000);
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-trainer-rule');
  const { page, shot } = run;
  const trainer = await openTrainer(page, 'Throttle');
  const fake = await hornet(page);
  const throttleKey = fake.keyOf('Throttle');
  const throttle = fake.controllerFor(throttleKey);
  const panelTitle = 'WinWing F18 STARTUP PANEL';
  const panel = fake.controllerFor(fake.keyOf(panelTitle));
  const round = roundOf(run, fake, throttleKey);
  const { count, verdict, note, summary, current, movedOn } = round;
  const onThrottle = (held: string[] = []) => stateOf(throttle, held);

  // A lever of the throttle rests in a position that holds a button, as the handles of the
  // owner's throttle do at OFF. The startup panel has not been heard from yet.
  const parked = fake.spare(throttle);
  await run.sendInput([onThrottle([parked])]);
  await heard(trainer, 1);
  await trainer.getByTestId('trainer-start').click();

  // ---- Card 1: the lever leaves its place for the control asked for, and stays there.
  const first = await current();
  await run.sendInput([onThrottle([first.answer.control])]);
  await expect(verdict).toHaveAttribute('data-phase', 'right');
  await expect(verdict).toContainText(`Right. ${first.answer.name} on Throttle`);
  await expect(verdict).toContainText('Let go of it for the next card');
  await expect(count).toHaveText('1 of 10 done');
  await shot('right-and-held');
  // The hand goes back: the lever leaves the control and arrives where it rested, as at the
  // sitting of 12 November. The next card comes, and the lever's place has not answered it.
  await run.sendInput([onThrottle(), onThrottle([parked])]);
  await movedOn(first.ask);
  const second = await current();
  await expect(note).toHaveCount(0);
  await expect(count).toHaveText('1 of 10 done');

  // ---- Card 2, and five things that are not an answer to it.
  // A lever on its way passes two positions and stops on neither. They are not what the
  // card asks for, so nothing is said of them. The startup panel is heard from for the
  // first time right after: once the page has that, it has the lever's way too.
  const passed = fake
    .cardsOn(throttleKey)
    .filter((c) => c.id !== first.card.id && c.id !== second.card.id)
    .flatMap((c) => c.answers)
    .filter((a) => a.deviceKey === throttleKey && a.control.startsWith('button:'))
    .slice(0, 2);
  expect(passed).toHaveLength(2);
  await run.sendInput([
    onThrottle([parked, passed[0]!.control]),
    onThrottle([parked, passed[1]!.control]),
    onThrottle([parked]),
  ]);
  await run.sendInput([stateOf(panel)]);
  await heard(trainer, 2);
  await expect(note).toHaveCount(0);
  await expect(verdict).toHaveAttribute('data-phase', 'asking');

  // A slower hand: the lever is off its place and back on it while the card is up. It went
  // back to where it was, which is said.
  await run.sendInput([onThrottle(), onThrottle([parked])]);
  await expect(note).toHaveAttribute('data-why', 'back-to-rest');
  await expect(note).toHaveAttribute('data-control', parked);
  await expect(note).toContainText(
    `${buttonName(parked)} on Throttle went back to where it was, so it is not counted.`
  );
  await shot('back-to-where-it-was');

  // The control that answered the card before is touched again.
  await run.sendInput([onThrottle([parked, first.answer.control])]);
  await expect(note).toHaveAttribute('data-why', 'last-card');
  await expect(note).toHaveAttribute('data-control', first.answer.control);
  await expect(note).toContainText(
    `${first.answer.name} on Throttle was in use on the card before, so it is not counted here.`
  );
  await shot('from-the-card-before');
  await run.sendInput([onThrottle([parked])]);

  // The control the card asks for, in a hurry: another one is let go as it goes down, and
  // it is let go at once. That is no tap, so it does not count. The user had it, and is
  // told to hold it.
  await run.sendInput([
    onThrottle([parked, passed[0]!.control]),
    onThrottle([parked, second.answer.control]),
    onThrottle([parked]),
  ]);
  await expect(note).toHaveAttribute('data-why', 'too-quick');
  await expect(note).toHaveAttribute('data-control', second.answer.control);
  await expect(note).toContainText(
    `${second.answer.name} on Throttle was let go too soon to count. Hold a control for a moment to answer with it.`
  );
  await expect(verdict).toHaveAttribute('data-phase', 'asking');
  await shot('let-go-too-soon');

  // A button of another device, as Button 8 of the startup panel was at the sitting. The
  // round is for the throttle, so it is said and uses up no try.
  await run.sendInput([stateOf(panel, ['button:8'])]);
  await expect(note).toHaveAttribute('data-why', 'other-device');
  await expect(note).toHaveAttribute('data-control', 'button:8');
  await expect(note).toContainText(
    `That was Button 8 on ${panelTitle}. This round is for Throttle only, so it is not counted.`
  );
  // Why a press was not counted is said in words, not by colour.
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('on-another-device');
  await run.sendInput([stateOf(panel)]);

  // None of the five was an answer: the question is still open and nothing is done.
  await expect(verdict).toHaveAttribute('data-phase', 'asking');
  await expect(count).toHaveText('1 of 10 done');
  await round.hold(second.answer, [parked]);
  await expect(verdict).toHaveAttribute('data-phase', 'right');
  await expect(note).toHaveCount(0);
  await expect(count).toHaveText('2 of 10 done');
  await round.letGo(second.answer, [parked]);
  await movedOn(second.ask);

  // ---- Card 3: a plain press, down and up again as a hand does it. Nothing has to be held
  // for that: it is the answer.
  const third = await current();
  await round.hold(third.answer, [parked]);
  await round.letGo(third.answer, [parked]);
  await expect(count).toHaveText('3 of 10 done');
  await movedOn(third.ask);

  // ---- The rest of the round. Nothing above was a miss: ten of ten, and nothing kept as wrong.
  const rest = await round.finish([parked]);
  expect(rest).toHaveLength(7);
  await expect(summary.getByTestId('trainer-score')).toHaveText('10 of 10 right first time');
  await expect(summary.getByTestId('trainer-missed')).toHaveCount(0);
  await shot('nothing-missed');
  await expect.poll(async () => (await kept(run)).rounds).toBe(1);
  const cards = Object.values((await kept(run)).cards);
  expect(cards).toHaveLength(10);
  expect(cards.filter((c) => c.wrong > 0 || c.right !== 1)).toEqual([]);
});

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** A box that is not on the page: no comparison with it holds. */
const NOWHERE: Box = { x: NaN, y: NaN, width: NaN, height: NaN };
/** A full HD screen at 125%, less the taskbar: a common window with room for two drawings. */
const WIDE = { width: 1536, height: 816 };

test('trainer: an action bound in several places is named and lit in every one of them, any of them is right, and two drawings are side by side in a wide window', async ({
  rig,
}) => {
  test.setTimeout(240_000);
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-trainer-places');
  const { page, shot } = run;
  await openSheets(page);
  const fake = await hornet(page);
  const stickKey = fake.keyOf('Stick');
  const throttleKey = fake.keyOf('Throttle');
  const stick = fake.controllerFor(stickKey);
  const throttle = fake.controllerFor(throttleKey);
  const onThrottle = fake.cardsOn(throttleKey);

  // The owner's throttle: radar elevation up is on Button 25 and on Button 28, down on
  // Button 27 and on Button 32, and the field of view of the sensor on 53 and on 56.
  const withBoth = (...buttons: string[]): Card =>
    onThrottle.find((c) =>
      buttons.every((control) =>
        c.answers.some((a) => a.deviceKey === throttleKey && a.control === control)
      )
    )!;
  const up = withBoth('button:25', 'button:28');
  const down = withBoth('button:27', 'button:32');
  const view = withBoth('button:53', 'button:56');
  expect([up, down, view].every(Boolean)).toBe(true);

  // So that these cards are asked in the first round, every card with one place only is
  // made a learned one: what is known least is asked first. (A fixture in the temp profile
  // of this run, put there the way the page keeps answers.)
  const single = fake.deck.cards
    .filter((c) => c.answers.length === 1)
    .map((c) => ({ cardId: c.id, right: true }));
  for (let time = 0; time < 2; time++) {
    for (let i = 0; i < single.length; i += 250) {
      await invoke(page, 'cheat-sheets:trainerRecord', {
        ...HORNET,
        answers: single.slice(i, i + 250),
      });
    }
  }
  const several = onThrottle.filter((c) => c.answers.length > 1);

  await page.getByTestId('sheet-learn').click();
  const trainer = page.getByTestId('trainer-page');
  await trainer.getByTestId('trainer-device').click();
  await page.getByRole('option', { name: /^Throttle · / }).click();
  await expect(trainer.getByTestId('trainer-progress')).toContainText(
    `${onThrottle.length - several.length} of ${onThrottle.length} learned`
  );
  // Every controller says where its controls rest.
  await run.sendInput(fake.controllers.map((c) => stateOf(c)));
  await heard(trainer, new Set(fake.controllers.map((c) => c.guid.toUpperCase())).size);
  await trainer.getByTestId('trainer-start').click();

  // ---- A round for the throttle. Each of the three cards is played another way.
  const round = roundOf(run, fake, throttleKey);
  const { verdict, summary } = round;
  const picture = trainer.getByTestId('trainer-picture');
  const wrong = fake.spare(throttle);
  const played = new Set<string>();
  for (;;) {
    const now = await round.turn();
    if (!now) break;
    const fresh = !played.has(now.card.id);
    played.add(now.card.id);
    if (fresh && now.card.id === up.id) {
      // Radar elevation up, answered with a button that is not it: both places are named
      // and both are lit.
      await expect(verdict).toContainText('Press the control for it on Throttle');
      await run.sendInput([stateOf(throttle, [wrong])]);
      await expect(verdict).toHaveAttribute('data-phase', 'wrong');
      await expect(verdict).toContainText(
        `Not that one. You pressed ${buttonName(wrong)} on Throttle`
      );
      await expect(verdict).toContainText(
        'It is Button 25 or Button 28 on Throttle, lit on the picture: press one of them to go on.'
      );
      await expect(picture).toHaveAttribute('data-target', 'button:25 button:28');
      await expect(picture).toHaveAttribute('data-wrong', wrong);
      await lit(picture, 'button:25', 'target');
      await lit(picture, 'button:28', 'target');
      expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
      await shot('both-places-after-a-miss');
      await run.sendInput([stateOf(throttle)]);
      // The second of the two is as good as the first, and the page says where the other is.
      await run.sendInput([stateOf(throttle, ['button:28'])]);
      await expect(verdict).toHaveAttribute('data-phase', 'corrected');
      await expect(verdict).toContainText(
        'That is it: Button 28 on Throttle. Button 25 does it too.'
      );
      await expect(picture).toHaveAttribute('data-right', 'button:25 button:28');
      await lit(picture, 'button:25', 'right');
      await lit(picture, 'button:28', 'right');
      await shot('the-other-place-is-right');
      await run.sendInput([stateOf(throttle)]);
    } else if (fresh && now.card.id === down.id) {
      // Radar elevation down, given away: both places again.
      await trainer.getByTestId('trainer-show').click();
      await expect(verdict).toHaveAttribute('data-phase', 'shown');
      await expect(verdict).toContainText(
        'It is Button 27 or Button 32 on Throttle, lit on the picture. Press one of them to go on.'
      );
      await expect(picture).toHaveAttribute('data-target', 'button:27 button:32');
      await lit(picture, 'button:27', 'target');
      await lit(picture, 'button:32', 'target');
      await run.sendInput([stateOf(throttle, ['button:32'])]);
      await expect(verdict).toHaveAttribute('data-phase', 'corrected');
      await expect(verdict).toContainText(
        'That is it: Button 32 on Throttle. Button 27 does it too.'
      );
      await run.sendInput([stateOf(throttle)]);
    } else if (fresh && now.card.id === view.id) {
      // Right first time, with the second of its two places.
      await run.sendInput([stateOf(throttle, ['button:56'])]);
      await expect(verdict).toHaveAttribute('data-phase', 'right');
      await expect(verdict).toContainText(
        'Right. Button 56 on Throttle. Button 53 does it too. Let go of it for the next card.'
      );
      await expect(picture).toHaveAttribute('data-right', 'button:53 button:56');
      await lit(picture, 'button:53', 'right');
      await lit(picture, 'button:56', 'right');
      // The cards of a round come shuffled, so this one is before the miss above in one run
      // and after it in the next: its picture has no number, and the numbered ones keep theirs.
      await page.screenshot({
        path: path.join(screensDir, 'cheat-sheets-trainer-places', 'right-in-either-place.png'),
      });
      await run.sendInput([stateOf(throttle)]);
    } else {
      await round.hold(now.answer);
      await expect(verdict).toHaveAttribute('data-phase', 'right');
      await round.letGo(now.answer);
    }
    await round.movedOn(now.ask);
  }
  expect([up.id, down.id, view.id].filter((id) => !played.has(id))).toEqual([]);
  await expect(summary.getByTestId('trainer-score')).toHaveText('8 of 10 right first time');
  // What was missed is listed with every place it is in.
  const missed = summary.getByTestId('trainer-missed');
  await expect(missed.locator('li')).toHaveCount(2);
  await expect(missed).toContainText('Button 25 or Button 28 on Throttle');
  await expect(missed).toContainText('Button 27 or Button 32 on Throttle');
  await shot('missed-with-every-place');

  // ---- A round for all devices. Radar elevation up is on the stick as well: it is asked
  // for on both devices, and both pictures are lit.
  await trainer.getByTestId('trainer-device').click();
  await page.getByRole('option', { name: 'All devices', exact: true }).click();
  await summary.getByTestId('trainer-again').click();
  const all = roundOf(run, fake);
  const pictureOf = (key: string): Locator =>
    trainer.locator(`[data-testid="trainer-picture"][data-device="${key}"]`);
  let shown = false;
  for (;;) {
    const now = await all.turn();
    if (!now) break;
    if (now.card.id === up.id && !shown) {
      shown = true;
      await expect(verdict).toContainText('Press the control for it on Stick or Throttle');
      const panels = trainer.getByTestId('trainer-device-panel');
      await expect(panels).toHaveCount(2);
      const boxes = async (): Promise<[Box, Box]> => {
        const at = async (i: number): Promise<Box> =>
          (await panels.nth(i).boundingBox()) ?? NOWHERE;
        return [await at(0), await at(1)];
      };
      const sideBySide = async (): Promise<boolean> => {
        const [a, b] = await boxes();
        return Math.abs(a.y - b.y) < 1 && b.x >= a.x + a.width;
      };
      const oneBelowTheOther = async (): Promise<boolean> => {
        const [a, b] = await boxes();
        return Math.abs(a.x - b.x) < 1 && b.y >= a.y + a.height;
      };
      await trainer.getByTestId('trainer-show').click();
      await expect(verdict).toHaveAttribute('data-phase', 'shown');
      await expect(verdict).toContainText(
        'It is Button 32 on Stick, or Button 25 or Button 28 on Throttle, lit on the picture. Press one of them to go on.'
      );
      await expect(pictureOf(stickKey)).toHaveAttribute('data-target', 'button:32');
      await expect(pictureOf(throttleKey)).toHaveAttribute('data-target', 'button:25 button:28');
      await lit(pictureOf(stickKey), 'button:32', 'target');
      await lit(pictureOf(throttleKey), 'button:25', 'target');
      await lit(pictureOf(throttleKey), 'button:28', 'target');
      expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);

      // The window as it opens has no room for two drawings that can be read: they are one
      // below the other, and the second one is further down the page.
      const narrow = await page.evaluate(() => {
        const { innerWidth, innerHeight } = globalThis as unknown as {
          innerWidth: number;
          innerHeight: number;
        };
        return { width: innerWidth, height: innerHeight };
      });
      expect(narrow.width).toBeLessThan(1500);
      await expect.poll(oneBelowTheOther).toBe(true);

      // A wide window (a full HD screen at 125%, less the taskbar): the two drawings are side
      // by side, as wide as each other, and on screen whole together with the card. Hands are
      // on the controls: there is nothing to scroll to see what is lit.
      await page.setViewportSize(WIDE);
      await expect.poll(sideBySide).toBe(true);
      const [left, right] = await boxes();
      expect(left.width).toBeGreaterThanOrEqual(400);
      expect(Math.abs(left.width - right.width)).toBeLessThan(1);
      await expect(trainer.getByTestId('trainer-card')).toBeInViewport({ ratio: 1 });
      await expect(panels.nth(0)).toBeInViewport({ ratio: 1 });
      await expect(panels.nth(1)).toBeInViewport({ ratio: 1 });
      await lit(pictureOf(stickKey), 'button:32', 'target');
      await lit(pictureOf(throttleKey), 'button:25', 'target');
      expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
      await shot('lit-on-both-devices');

      // Narrow again: one below the other, as before.
      await page.setViewportSize(narrow);
      await expect.poll(oneBelowTheOther).toBe(true);
      await pictureOf(throttleKey).scrollIntoViewIfNeeded();
      await shot('lit-on-the-other-device');

      // The one on the stick is it too, and the page says where the others are.
      await page.setViewportSize(WIDE);
      await expect.poll(sideBySide).toBe(true);
      await run.sendInput([stateOf(stick, ['button:32'])]);
      await expect(verdict).toHaveAttribute('data-phase', 'corrected');
      await expect(verdict).toContainText(
        'That is it: Button 32 on Stick. Button 25 and Button 28 on Throttle do it too.'
      );
      await expect(pictureOf(stickKey)).toHaveAttribute('data-right', 'button:32');
      await expect(pictureOf(throttleKey)).toHaveAttribute('data-right', 'button:25 button:28');
      expect(await sideBySide()).toBe(true);
      await shot('right-on-either-device');
      await run.sendInput([stateOf(stick)]);
      await all.movedOn(now.ask);
      // A card on one device has the page at the width it always had.
      await page.setViewportSize(narrow);
      continue;
    } else {
      await all.hold(now.answer);
      await expect(verdict).toHaveAttribute('data-phase', 'right');
      await all.letGo(now.answer);
    }
    await all.movedOn(now.ask);
  }
  expect(shown).toBe(true);
  await expect(summary.getByTestId('trainer-score')).toHaveText('9 of 10 right first time');
});

test('trainer: opened while the quick look is popped out, it is told where the controls rest, and no window takes that for a press', async ({
  rig,
}) => {
  test.setTimeout(120_000);
  const flow = 'cheat-sheets-trainer-windows';
  const run = await rig.launch('cheat-sheets-hornet', flow);
  const { page, app, shot } = run;
  await openSheets(page);
  const fake = await hornet(page);
  const stickKey = fake.keyOf('Stick');
  const stick = fake.controllerFor(stickKey);
  // Two buttons of the stick that do something, the lower number first, and one that does not.
  const [low, high] = fake
    .cardsOn(stickKey)
    .flatMap((c) => c.answers)
    .filter((a) => a.deviceKey === stickKey && a.control.startsWith('button:'))
    .map((a) => Number(a.control.split(':')[1]))
    .sort((a, b) => a - b)
    .map((n) => `button:${n}`);
  const parked = fake.spare(stick);

  // ---- The quick look in the main window, and a switch of the stick that is on.
  await page.getByTestId('sheet-quick').click();
  const quick = page.getByTestId('quick-look');
  await expect(quick).toHaveAttribute('data-live', 'true');
  await run.sendInput([stateOf(stick, [low!])]);
  await expect(quick.getByTestId('sheet-view')).toHaveAttribute('data-device', stickKey);
  await expect(quick.locator(`.cs-ctl[data-control="${low}"]`)).toHaveClass(/cs-on/);

  // ---- Popped out: a second window begins to listen while the first one does. It is told
  // that the switch is on, so it is lit there. It was not pressed just now, so it is not
  // what the window names as the last thing pressed.
  const [popup] = await Promise.all([
    app.waitForEvent('window'),
    page.getByTestId('quick-popout').click(),
  ]);
  await popup.waitForLoadState('domcontentloaded');
  const popped = popup.getByTestId('quick-look');
  const last = popup.getByTestId('quick-last');
  await expect(popped).toHaveAttribute('data-live', 'true');
  await expect(popped.getByTestId('sheet-view')).toHaveAttribute('data-device', stickKey);
  await expect(popped.locator(`.cs-ctl[data-control="${low}"]`)).toHaveClass(/cs-on/);
  await expect(last).toHaveAttribute('data-last', '');
  // A button goes down beside the switch: the new window names the button, not the switch.
  await run.sendInput([stateOf(stick, [low!, high!])]);
  await expect(last).toHaveAttribute('data-last', high!);
  await shot('quick-look');
  await popup.screenshot({ path: path.join(screensDir, flow, 'pop-out.png') });

  // The hand lets go. A switch of the stick that does nothing in the game stays on.
  await run.sendInput([stateOf(stick, [parked])]);
  await expect(last).toHaveAttribute('data-last', parked);

  // ---- The trainer, opened in the main window while the pop-out goes on listening. The
  // stick says nothing new, yet the trainer is told where its controls are.
  await page.getByTestId('quick-back').click();
  await page.getByTestId('sheet-learn').click();
  const trainer = page.getByTestId('trainer-page');
  await trainer.getByTestId('trainer-device').click();
  await page.getByRole('option', { name: /^Stick · / }).click();
  await heard(trainer, 1);
  // The pop-out was told again as well, and took it for no press.
  await expect(last).toHaveAttribute('data-last', parked);
  await trainer.getByTestId('trainer-start').click();

  // So the first press of the round is an answer: the trainer knows the switch from it.
  const round = roundOf(run, fake, stickKey);
  const first = await round.current();
  await round.hold(first.answer, [parked]);
  await expect(round.verdict).toHaveAttribute('data-phase', 'right');
  await expect(round.count).toHaveText('1 of 10 done');
  await expect(round.note).toHaveCount(0);
  await shot('trainer-beside-the-pop-out');
  await round.letGo(first.answer, [parked]);
  await round.movedOn(first.ask);
  await popup.close();
});

test('trainer: a switch that stays held is drawn quietly, so the control asked for stands out', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-trainer-held');
  const { page, shot } = run;
  const trainer = await openTrainer(page, 'Stick');
  const fake = await hornet(page);
  const stickKey = fake.keyOf('Stick');
  // Three buttons are down before the round starts and stay down, as switches left on do.
  // Each is of another card, so at least two of them are not what the first card asks for.
  const resting = fake
    .cardsOn(stickKey)
    .map(
      (c) =>
        c.answers.find((a) => a.deviceKey === stickKey && a.control.startsWith('button:'))?.control
    )
    .filter((control): control is string => control !== undefined)
    .slice(0, 3);
  expect(resting).toHaveLength(3);
  await run.sendInput([stateOf(fake.controllerFor(stickKey), resting)]);
  await heard(trainer, 1);
  await trainer.getByTestId('trainer-start').click();

  const card = trainer.getByTestId('trainer-card');
  const verdict = trainer.getByTestId('trainer-verdict');
  const picture = trainer.getByTestId('trainer-picture');
  await expect(verdict).toHaveAttribute('data-phase', 'asking');
  // What rests is not taken for an answer.
  await expect(card.getByTestId('trainer-count')).toHaveText('0 of 10 done');
  await trainer.getByTestId('trainer-show').click();
  await expect(verdict).toHaveAttribute('data-phase', 'shown');
  const targets = ((await picture.getAttribute('data-target')) ?? '').split(' ').filter(Boolean);
  expect(targets.length).toBeGreaterThan(0);

  const outline = (control: string) =>
    picture
      .locator(
        `.cs-ctl[data-control="${control}"] .cs-card, .cs-ctl[data-control="${control}"] .cs-row`
      )
      .first();
  // The controls asked for: a heavy outline with a glow.
  for (const target of targets) {
    await lit(picture, target, 'target');
    await expect(outline(target)).toHaveCSS('stroke-width', '3.2px');
    await expect(outline(target)).not.toHaveCSS('filter', 'none');
  }
  // The switches that are simply on: still marked as held, with a thin outline and no glow.
  const quiet = resting.filter((control) => !targets.includes(control));
  expect(quiet.length).toBeGreaterThanOrEqual(2);
  for (const control of quiet) {
    const held = picture.locator(`.cs-ctl[data-control="${control}"]`);
    await expect(held).toHaveClass(/cs-on/);
    await expect(held).not.toHaveClass(/tr-target/);
    await expect(outline(control)).toHaveCSS('stroke-width', '1.2px');
    await expect(outline(control)).toHaveCSS('filter', 'none');
  }
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('held-and-shown');
});

/** What the page can do with the animations under an element. */
interface Animated {
  getAnimations(options: { subtree: boolean }): {
    animationName?: string;
    pause(): void;
    currentTime: number | null;
  }[];
}

test('trainer: a card whose control is already in place says so, and a control that is being weighed shows a line until it counts', async ({
  rig,
}) => {
  const flow = 'cheat-sheets-trainer-in-place';
  const run = await rig.launch('cheat-sheets-hornet', flow);
  const { page, shot } = run;
  // The time of the page is the test's to stop, for the picture of a control half weighed.
  await page.clock.install();
  const trainer = await openTrainer(page, 'Throttle');
  const fake = await hornet(page);
  const throttleKey = fake.keyOf('Throttle');
  const throttle = fake.controllerFor(throttleKey);
  const panel = fake.controllerFor(fake.keyOf('WinWing F18 STARTUP PANEL'));
  const { count, verdict, note, summary, current } = roundOf(run, fake, throttleKey);
  const inPlace = trainer.getByTestId('trainer-in-place');
  const onThrottle = (held: string[] = []) => stateOf(throttle, held);

  await run.sendInput([onThrottle()]);
  await heard(trainer, 1);
  await trainer.getByTestId('trainer-start').click();

  // ---- The first card is not known: "Show me", and the round is stopped. The card is
  // kept as missed. Nothing is held, so nothing is said to be in place.
  const asked = await current();
  await expect(inPlace).toHaveCount(0);
  await trainer.getByTestId('trainer-show').click();
  await expect(verdict).toHaveAttribute('data-phase', 'shown');
  await expect(inPlace).toHaveCount(0);
  await trainer.getByTestId('trainer-stop').click();
  const again = summary.getByTestId('trainer-again-missed');
  await expect(again).toBeVisible();

  // ---- The control is put where that card asks and left there, as a switch that stays on
  // is. The startup panel is heard from for the first time right after: once the page has
  // that, it has the switch too.
  await run.sendInput([onThrottle([asked.answer.control])]);
  await run.sendInput([stateOf(panel)]);
  await heard(trainer, 2);

  // ---- "Practise the missed" asks that one card. Its control is where it rests, which is
  // not a press: the card says so, and how to answer with it.
  await again.click();
  expect((await current()).card.id).toBe(asked.card.id);
  await expect(count).toHaveText('0 of 1 done');
  await expect(inPlace).toHaveText(
    `${asked.places.length > 1 ? 'One of the controls for it is' : 'The control for it is'} already in place. Move it away and straight back.`
  );
  await expect(note).toHaveCount(0);
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('already-in-place');

  // ---- Moved away: it is in place no longer, and the line goes.
  await run.sendInput([onThrottle()]);
  await expect(inPlace).toHaveCount(0);
  await expect(verdict).toHaveAttribute('data-phase', 'asking');

  // ---- And straight back. Time is stopped while it is held, so that the moment it is
  // weighed for can be looked at: a thin line grows over the question, and nothing is
  // right or wrong yet. A clock can only be stopped ahead of where it is, so it is stopped
  // well ahead: nothing in the round waits on time while the question is open.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 10_000);
  await run.sendInput([onThrottle([asked.answer.control])]);
  await expect(verdict).toHaveAttribute('data-weighing', asked.answer.control);
  await expect(verdict).toHaveClass(/is-weighing/);
  // Half of the moment goes by. The line is drawn by the window, not by the page's clock,
  // so it is put at the same point.
  await page.clock.runFor(HOLD_MS / 2);
  const lines = await verdict.evaluate((el, at) => {
    const growing = (el as unknown as Animated)
      .getAnimations({ subtree: true })
      .filter((a) => (a.animationName ?? '').startsWith('trainer-weigh'));
    for (const line of growing) {
      line.pause();
      line.currentTime = at;
    }
    return growing.length;
  }, HOLD_MS / 2);
  expect(lines).toBe(1);
  await expect(verdict).toHaveAttribute('data-phase', 'asking');
  await expect(verdict).toHaveAttribute('data-weighing', asked.answer.control);
  await expect(count).toHaveText('0 of 1 done');
  // The line is held half way, which the numbered pictures do not wait for.
  await page.screenshot({ path: path.join(screensDir, flow, 'being-weighed.png') });

  // ---- The rest of the moment: held long enough, it counts and the line is gone.
  await page.clock.runFor(HOLD_MS);
  await expect(verdict).toHaveAttribute('data-phase', 'right');
  await expect(verdict).not.toHaveClass(/is-weighing/);
  await page.clock.resume();
  await expect(count).toHaveText('1 of 1 done');
  await run.sendInput([onThrottle()]);
  await expect(summary.getByTestId('trainer-score')).toHaveText('1 of 1 right first time');
});

test('trainer: a racing game is asked the same way, on the buttons of the wheel', async ({
  rig,
}) => {
  const run = await rig.launch('mark-racing', 'cheat-sheets-trainer-racing');
  const { page, shot } = run;
  // The page opens on the game it suggests; once that sheet is drawn, another is chosen.
  await openSheets(page);
  await page.getByTestId('sheet-aircraft').click();
  await page.getByRole('option', { name: 'iRacing · All cars' }).click();
  await expect(page.getByTestId('sheet-name')).toHaveText('iRacing');

  // From the sheet of the game to its trainer: the one set a racing game keeps for every
  // car is called by the game, "in iRacing" and not "in All cars".
  await page.getByTestId('sheet-learn').click();
  const trainer = page.getByTestId('trainer-page');
  await expect(trainer.getByTestId('trainer-aircraft')).toContainText('iRacing · All cars');
  const wheel = 'FANATEC Podium Wheel Base DD2';
  const car = { game: 'iracing', aircraftId: 'all' };
  const deck = await invoke<Deck>(page, 'cheat-sheets:trainerDeck', car);
  expect(deck.cards.map((c) => c.plain ?? c.action)).toContain('Shift up');
  await expect(trainer.getByTestId('trainer-intro')).toContainText(
    `${deck.cards.length} controls to know in iRacing`
  );
  await expect(trainer.getByTestId('trainer-intro')).not.toContainText('All cars');

  const controllers = await invoke<Controller[]>(page, 'devices:inputDevices');
  const base = controllers.find((c) => c.guid.toUpperCase() === deck.cards[0]!.answers[0]!.guid)!;
  await run.sendInput([stateOf(base)]);
  await heard(trainer, 1);
  await trainer.getByTestId('trainer-start').click();

  // Whatever is asked first: the button for it on the wheel, held for a moment, is right,
  // and lit on the picture of the wheel.
  const card = trainer.getByTestId('trainer-card');
  const verdict = trainer.getByTestId('trainer-verdict');
  const picture = trainer.getByTestId('trainer-picture');
  await expect(verdict).toHaveAttribute('data-phase', 'asking');
  await expect(verdict).toContainText(`Press the control for it on ${wheel}`);
  const id = await card.getAttribute('data-card-id');
  const ask = await card.getAttribute('data-ask');
  const asked = deck.cards.find((c) => c.id === id)!;
  const answer = asked.answers[0]!;
  await expect(card.getByTestId('trainer-action')).toHaveText(asked.plain ?? asked.action);
  // The kinds are a car's: driving and looking about, no weapons.
  await expect(card.locator('.trainer-kind')).toHaveText(/^\s*(Driving|View)\s*$/);
  await expect(picture.locator('.cs-ctl.cs-bound')).toHaveCount(0);
  await shot('asking');
  await run.sendInput([stateOf(base, [answer.control])]);
  await expect(verdict).toHaveAttribute('data-phase', 'right');
  await expect(verdict).toContainText(`Right. ${answer.name} on ${wheel}`);
  await expect(picture).toHaveAttribute(
    'data-right',
    asked.answers.map((a) => a.control).join(' ')
  );
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('right');
  await run.sendInput([stateOf(base)]);
  await expect(
    trainer.locator(`[data-testid="trainer-card"]:not([data-ask="${ask}"])`)
  ).toBeVisible();

  // What was answered is kept for the game's one set, beside any aircraft.
  await expect
    .poll(async () => (await kept(run, 'iracing/all')).cards[asked.id])
    .toMatchObject({ right: 1, wrong: 0, streak: 1 });
});

test('trainer: a round can be stopped, and a PC without a game to read says what is missing', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-trainer-stop');
  const { page, shot } = run;
  const trainer = await openTrainer(page);
  await trainer.getByTestId('trainer-start').click();
  await expect(trainer.getByTestId('trainer-verdict')).toHaveAttribute('data-phase', 'asking');
  await trainer.getByTestId('trainer-stop').click();
  await expect(trainer.getByTestId('trainer-score')).toHaveText('0 of 10 right first time');
  await expect(trainer.getByTestId('trainer-summary')).toContainText(
    'The round was stopped before its end, so it does not count as played'
  );
  await expect(trainer.getByTestId('trainer-progress')).toContainText('0 rounds played');
  await shot('stopped');
  // Back to the cheat sheet of the same aircraft.
  await trainer.getByTestId('trainer-back').click();
  await expect(page.getByTestId('sheet-aircraft')).toContainText('F/A-18C');
  await run.app.close();

  const generic = await rig.launch('generic-fresh', 'cheat-sheets-trainer-none');
  await generic.page.evaluate(() => {
    (globalThis as unknown as { location: { hash: string } }).location.hash =
      '#/configure/cheat-sheets/learn';
  });
  await expect(generic.page.getByTestId('trainer-none')).toContainText(
    'No game whose bindings RigReady can read was found on this PC'
  );
  await generic.shot('no-game');
});
