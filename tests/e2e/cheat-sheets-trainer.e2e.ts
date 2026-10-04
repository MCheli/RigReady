import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { axeViolations, colourOnlyStatus } from './a11y';
import { expect, test, type RunningApp } from './harness';

/**
 * "Learn your controls": RigReady names an action of the F/A-18C, the control is pressed
 * on the (fake) device as a hand would press it, and the page says right or wrong at once.
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

test('trainer: an action is named, the control is pressed on the device, right or wrong is said at once, missed cards come back, and what is learned is kept', async ({
  rig,
}) => {
  test.setTimeout(180_000);
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-trainer');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-cheat-sheets').click();
  await expect(page.getByTestId('sheet-view').first()).toBeVisible();

  // From the cheat sheet of the aircraft to its trainer.
  await page.getByTestId('sheet-learn').click();
  const trainer = page.getByTestId('trainer-page');
  await expect(trainer.locator('h1')).toHaveText('Learn your controls');
  await expect(trainer.getByTestId('trainer-aircraft')).toContainText('F/A-18C');

  const controllers = await invoke<Controller[]>(page, 'devices:inputDevices');
  const deck = await invoke<{ cards: Card[]; devices: { key: string; title: string }[] }>(
    page,
    'cheat-sheets:trainerDeck',
    HORNET
  );
  const stickKey = deck.devices.find((d) => d.title === 'Stick')!.key;
  const onStick = deck.cards.filter((c) => c.answers.some((a) => a.deviceKey === stickKey));
  const controllerOf = (guid: string): Controller =>
    controllers.find((c) => c.guid.toUpperCase() === guid)!;
  const hold = (a: Answer) => run.sendInput([stateOf(controllerOf(a.guid), [a.control])]);
  const letGo = (a: Answer) => run.sendInput([stateOf(controllerOf(a.guid))]);

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

  // The controllers say where they rest; from then on a control that goes down is a press.
  const stick = controllerOf(onStick[0]!.answers.find((a) => a.deviceKey === stickKey)!.guid);
  await run.sendInput([stateOf(stick)]);
  await expect(trainer).toHaveAttribute('data-live', 'true');
  await trainer.getByTestId('trainer-start').click();

  const card = trainer.getByTestId('trainer-card');
  const verdict = trainer.getByTestId('trainer-verdict');
  const picture = trainer.getByTestId('trainer-picture');
  const summary = trainer.getByTestId('trainer-summary');
  const current = async (): Promise<{ card: Card; answer: Answer; ask: string }> => {
    await expect(verdict).toHaveAttribute('data-phase', 'asking');
    const id = await card.getAttribute('data-card-id');
    const found = deck.cards.find((c) => c.id === id)!;
    return {
      card: found,
      answer: found.answers.find((a) => a.deviceKey === stickKey)!,
      ask: (await card.getAttribute('data-ask')) ?? '',
    };
  };
  /** The card on screen has been replaced by the next one, or the round is over. */
  const movedOn = (ask: string) =>
    expect(
      trainer.locator(
        `[data-testid="trainer-card"]:not([data-ask="${ask}"]), [data-testid="trainer-summary"]`
      )
    ).toBeVisible();
  const lit = (control: string, as: 'right' | 'wrong' | 'target') =>
    expect(picture.locator(`.cs-ctl[data-control="${control}"]`)).toHaveClass(
      new RegExp(`tr-${as}`)
    );

  // ---- Card 1: the right control. Right at once, lit on the picture; letting go moves on.
  await expect(card.getByTestId('trainer-count')).toHaveText('0 of 10 done');
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
  await expect(picture).toHaveAttribute('data-right', first.answer.control);
  await lit(first.answer.control, 'right');
  await expect(card.getByTestId('trainer-count')).toHaveText('1 of 10 done');
  await shot('right');
  await letGo(first.answer);
  await movedOn(first.ask);

  // ---- Card 2: another control. Wrong at once: what was pressed and what it does, and the
  // right one lit. Pressing that goes on, and the card will come back.
  const second = await current();
  // A control of the stick that does something else, and does not do this as well.
  const other = onStick.find(
    (c) =>
      c.id !== second.card.id &&
      !c.answers.some((a) => second.card.answers.some((b) => b.control === a.control))
  )!;
  const mistake = other.answers.find((a) => a.deviceKey === stickKey)!;
  await hold(mistake);
  await expect(verdict).toHaveAttribute('data-phase', 'wrong');
  await expect(verdict).toContainText(`Not that one. You pressed ${mistake.name} on Stick`);
  // What the wrong control does is named as its own card would name it.
  await expect(verdict).toContainText(`which is ${other.plain ?? other.action}`);
  await expect(verdict).toContainText(`It is ${second.answer.name} on Stick`);
  await lit(mistake.control, 'wrong');
  await lit(second.answer.control, 'target');
  await expect(card.getByTestId('trainer-count')).toHaveText('1 of 10 done');
  // Right, wrong and "it is this one" are said in words and icons, not by colour alone.
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('wrong');
  await letGo(mistake);
  await expect(verdict).toHaveAttribute('data-phase', 'wrong');
  await hold(second.answer);
  await expect(verdict).toHaveAttribute('data-phase', 'corrected');
  await expect(verdict).toContainText('This one comes back later in the round');
  await lit(second.answer.control, 'right');
  await letGo(second.answer);
  await movedOn(second.ask);

  // ---- Card 3: "Show me" gives it away, which is a miss too.
  const third = await current();
  await trainer.getByTestId('trainer-show').click();
  await expect(verdict).toHaveAttribute('data-phase', 'shown');
  await expect(verdict).toContainText(`It is ${third.answer.name} on Stick`);
  await lit(third.answer.control, 'target');
  await shot('shown');
  await hold(third.answer);
  await expect(verdict).toHaveAttribute('data-phase', 'corrected');
  await letGo(third.answer);
  await movedOn(third.ask);

  /** Answers every card right until the round is over; says which cards were asked. */
  const finish = async (): Promise<string[]> => {
    const asked: string[] = [];
    for (;;) {
      await expect(
        trainer.locator(
          '[data-testid="trainer-verdict"][data-phase="asking"], [data-testid="trainer-summary"]'
        )
      ).toBeVisible();
      if ((await summary.count()) > 0) return asked;
      const now = await current();
      asked.push(now.card.id);
      await hold(now.answer);
      await expect(verdict).toHaveAttribute('data-phase', 'right');
      await letGo(now.answer);
      await movedOn(now.ask);
    }
  };

  // ---- The rest of the round, all right. The two missed cards come back in it.
  const rest = await finish();
  expect(rest).toContain(second.card.id);
  expect(rest).toContain(third.card.id);
  expect(rest).toHaveLength(9);
  await expect(summary.getByTestId('trainer-score')).toHaveText('8 of 10 right first time');
  const missed = summary.getByTestId('trainer-missed');
  await expect(missed.locator('li')).toHaveCount(2);
  await expect(missed).toContainText(second.card.plain ?? second.card.action);
  await expect(missed).toContainText(`${second.answer.name} on Stick`);
  await expect(missed).toContainText(third.card.plain ?? third.card.action);
  await expect(trainer.getByTestId('trainer-progress')).toContainText('1 round played');
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('round-over');

  // What was answered is kept under the data root, per aircraft.
  const file = path.join(run.dataRoot, 'cheat-sheets', 'trainer.json');
  const kept = async (): Promise<Progress> =>
    (JSON.parse(await fs.readFile(file, 'utf8')) as { aircraft: Record<string, Progress> })
      .aircraft['dcs/FA-18C_hornet']!;
  await expect.poll(async () => (await kept()).rounds).toBe(1);
  let progress = await kept();
  expect(Object.keys(progress.cards)).toHaveLength(10);
  expect(progress.cards[first.card.id]).toMatchObject({ right: 1, wrong: 0, streak: 1 });
  expect(progress.cards[second.card.id]).toMatchObject({ right: 0, wrong: 1, streak: 0 });
  expect(progress.cards[third.card.id]).toMatchObject({ right: 0, wrong: 1, streak: 0 });

  // ---- "Practise the missed": a round of just those two.
  await summary.getByTestId('trainer-again-missed').click();
  await expect(card.getByTestId('trainer-count')).toHaveText('0 of 2 done');
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
  await expect.poll(async () => (await kept()).rounds).toBe(4);
  progress = await kept();
  expect(Object.values(progress.cards).filter((c) => c.streak >= 2)).toHaveLength(10);
  await shot('learned');

  // ---- It is still there after a restart.
  const restarted: RunningApp = await run.restart();
  const p = restarted.page;
  await p.getByTestId('mode-configure').click();
  await p.getByTestId('nav-cheat-sheets').click();
  await p.getByTestId('sheet-learn').click();
  const back = p.getByTestId('trainer-page');
  await back.getByTestId('trainer-device').click();
  await p.getByRole('option', { name: /^Stick · / }).click();
  await expect(back.getByTestId('trainer-progress')).toContainText(
    `10 of ${onStick.length} learned`
  );
  await expect(back.getByTestId('trainer-progress')).toContainText('4 rounds played');
  await restarted.shot('after-restart');
});

test('trainer: a racing game is asked the same way, on the buttons of the wheel', async ({
  rig,
}) => {
  const run = await rig.launch('mark-racing', 'cheat-sheets-trainer-racing');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-cheat-sheets').click();
  // The page opens on the game it suggests; once that sheet is drawn, another is chosen.
  await expect(page.getByTestId('sheet-view').first()).toBeVisible();
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
  const deck = await invoke<{ cards: Card[] }>(page, 'cheat-sheets:trainerDeck', car);
  expect(deck.cards.map((c) => c.plain ?? c.action)).toContain('Shift up');
  await expect(trainer.getByTestId('trainer-intro')).toContainText(
    `${deck.cards.length} controls to know in iRacing`
  );
  await expect(trainer.getByTestId('trainer-intro')).not.toContainText('All cars');

  const controllers = await invoke<Controller[]>(page, 'devices:inputDevices');
  const base = controllers.find((c) => c.guid.toUpperCase() === deck.cards[0]!.answers[0]!.guid)!;
  await run.sendInput([stateOf(base)]);
  await expect(trainer).toHaveAttribute('data-live', 'true');
  await trainer.getByTestId('trainer-start').click();

  // Whatever is asked first: the button for it on the wheel is right at once, and lit on
  // the picture of the wheel.
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
  await expect(picture).toHaveAttribute('data-right', answer.control);
  expect([...(await axeViolations(page)), ...(await colourOnlyStatus(page))]).toEqual([]);
  await shot('right');
  await run.sendInput([stateOf(base)]);
  await expect(
    trainer.locator(`[data-testid="trainer-card"]:not([data-ask="${ask}"])`)
  ).toBeVisible();

  // What was answered is kept for the game's one set, beside any aircraft.
  const file = path.join(run.dataRoot, 'cheat-sheets', 'trainer.json');
  await expect
    .poll(async () => {
      const all = JSON.parse(await fs.readFile(file, 'utf8')) as {
        aircraft: Record<string, Progress>;
      };
      return all.aircraft['iracing/all']?.cards[asked.id];
    })
    .toMatchObject({ right: 1, wrong: 0, streak: 1 });
});

test('trainer: a round can be stopped, and a PC without a game to read says what is missing', async ({
  rig,
}) => {
  const run = await rig.launch('cheat-sheets-hornet', 'cheat-sheets-trainer-stop');
  const { page, shot } = run;
  await page.getByTestId('mode-configure').click();
  await page.getByTestId('nav-cheat-sheets').click();
  await page.getByTestId('sheet-learn').click();
  const trainer = page.getByTestId('trainer-page');
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
