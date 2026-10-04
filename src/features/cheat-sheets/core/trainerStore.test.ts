import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { TrainerDeck } from '../trainerContract';
import type { AircraftProgress } from './trainer';

let app: WiredApp | undefined;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
  app = undefined;
});

const HORNET = { game: 'dcs', aircraftId: 'FA-18C_hornet' };
const FILES = { files: ['Saved Games/DCS/**', 'Program Files (x86)/Steam/**'] };
const deckOf = (a: WiredApp) => a.invoke<TrainerDeck>('cheat-sheets:trainerDeck', HORNET);
const file = (a: WiredApp): string =>
  path.join(a.ports.folders.dataRoot(), 'cheat-sheets', 'trainer.json');

describe('the cards of an aircraft', () => {
  it('asks what the Hornet has bound on the controllers of the rig, by the names the owner gave them', async () => {
    app = await wiredApp('cheat-sheets-hornet', FILES);
    const deck = await deckOf(app);
    expect(deck.aircraft).toEqual({ id: 'FA-18C_hornet', name: 'F/A-18C' });
    expect(deck.gameName).toBe('DCS World');
    expect(deck.cards.length).toBeGreaterThan(100);
    expect(deck.unplugged).toEqual([]);
    expect(deck.progress).toEqual({ rounds: 0, cards: {} });

    // A plain wording where the binding guide has one, with the game's own name kept.
    const trim = deck.cards.find((c) => c.action === 'Trimmer Switch - PULL(CLIMB)')!;
    expect(trim).toMatchObject({
      plain: 'Trim nose up',
      kind: 'flight',
      answers: [{ device: 'Stick', control: 'hat:1:D', name: 'Hat 1 down' }],
    });
    // Every answer is something that can be pressed, on a controller that is attached.
    const connected = new Set(app.ports.input.devices().map((d) => d.guid.toUpperCase()));
    for (const card of deck.cards) {
      expect(card.answers.length).toBeGreaterThan(0);
      for (const answer of card.answers) {
        expect(answer.control).toMatch(/^(button:\d+|hat:\d:[UDLR]{1,2})$/);
        expect(connected.has(answer.guid), `${card.action} on ${answer.device}`).toBe(true);
      }
    }
    // One card per action, however many controls do it.
    expect(new Set(deck.cards.map((c) => c.id)).size).toBe(deck.cards.length);

    // The devices to practise on, with how many cards each has.
    expect(deck.devices.map((d) => d.title)).toEqual(
      expect.arrayContaining(['Stick', 'Throttle', 'Left MFD'])
    );
    const stick = deck.devices.find((d) => d.title === 'Stick')!;
    expect(stick.cards).toBe(
      deck.cards.filter((c) => c.answers.some((a) => a.deviceKey === stick.key)).length
    );
    expect(stick.cards).toBeGreaterThan(10);
  });

  it('leaves out the controls of a device that is not connected, and says which', async () => {
    app = await wiredApp('cheat-sheets-hornet', FILES);
    const before = await deckOf(app);
    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '4098', productId: 'BEA8' } }]);
    const after = await deckOf(app);
    expect(after.unplugged).toEqual(['Stick']);
    expect(after.devices.map((d) => d.title)).not.toContain('Stick');
    expect(after.cards.length).toBeLessThan(before.cards.length);
    expect(after.cards.some((c) => c.answers.some((a) => a.device === 'Stick'))).toBe(false);
  });

  it('says so for a game whose bindings cannot be read', async () => {
    app = await wiredApp('cheat-sheets-hornet', FILES);
    await expect(
      app.invoke('cheat-sheets:trainerDeck', { game: 'no-such-game', aircraftId: 'x' })
    ).rejects.toThrow(/cannot read the bindings/);
  });
});

describe('what is remembered, under the data root', () => {
  it('keeps each answer per aircraft in cheat-sheets/trainer.json and gives it back with the cards', async () => {
    app = await wiredApp('cheat-sheets-hornet', FILES);
    const deck = await deckOf(app);
    const [first, second] = deck.cards;
    const at = app.clock.now().toISOString();
    let progress = await app.invoke<AircraftProgress>('cheat-sheets:trainerRecord', {
      ...HORNET,
      answers: [{ cardId: first!.id, right: true }],
    });
    expect(progress.cards[first!.id]).toEqual({ right: 1, wrong: 0, streak: 1, last: at });
    expect(progress.rounds).toBe(0);

    app.clock.advance(60_000);
    const later = app.clock.now().toISOString();
    progress = await app.invoke<AircraftProgress>('cheat-sheets:trainerRecord', {
      ...HORNET,
      answers: [
        { cardId: first!.id, right: true },
        { cardId: second!.id, right: false },
      ],
      finished: true,
    });
    expect(progress).toEqual({
      rounds: 1,
      lastPlayed: later,
      cards: {
        [first!.id]: { right: 2, wrong: 0, streak: 2, last: later },
        [second!.id]: { right: 0, wrong: 1, streak: 0, last: later },
      },
    });

    // It is a file under the data root, by aircraft.
    const stored = JSON.parse(await fs.readFile(file(app), 'utf8')) as {
      schemaVersion: number;
      aircraft: Record<string, AircraftProgress>;
    };
    expect(stored.schemaVersion).toBe(1);
    expect(Object.keys(stored.aircraft)).toEqual(['dcs/FA-18C_hornet']);
    expect(stored.aircraft['dcs/FA-18C_hornet']).toEqual(progress);

    // Another aircraft has its own record, and the Hornet's comes back with its cards.
    await app.invoke('cheat-sheets:trainerRecord', {
      game: 'dcs',
      aircraftId: 'UH-1H',
      answers: [{ cardId: 'something', right: true }],
    });
    expect((await deckOf(app)).progress).toEqual(progress);
    // Nothing outside the data folder was touched.
    const journal = await app.ports.files.journal();
    expect(journal.ok && journal.value).toEqual([]);
  });

  it('counts a round played to the end even when nothing was answered in the last call', async () => {
    app = await wiredApp('cheat-sheets-hornet', FILES);
    const progress = await app.invoke<AircraftProgress>('cheat-sheets:trainerRecord', {
      ...HORNET,
      answers: [],
      finished: true,
    });
    expect(progress).toEqual({
      rounds: 1,
      lastPlayed: app.clock.now().toISOString(),
      cards: {},
    });
  });

  it('does not overwrite a progress file it cannot read, and says so', async () => {
    app = await wiredApp('cheat-sheets-hornet', FILES);
    await fs.mkdir(path.dirname(file(app)), { recursive: true });
    await fs.writeFile(file(app), '{ "aircraft": [1, 2');
    await expect(
      app.invoke('cheat-sheets:trainerRecord', {
        ...HORNET,
        answers: [{ cardId: 'a', right: true }],
      })
    ).rejects.toThrow(/trainer\.json is not valid JSON/);
    await expect(deckOf(app)).rejects.toThrow(/trainer\.json is not valid JSON/);
    expect(await fs.readFile(file(app), 'utf8')).toBe('{ "aircraft": [1, 2');
  });

  it('does not say kept when the file does not hold the answer afterwards', async () => {
    app = await wiredApp('cheat-sheets-hornet', FILES);
    // The write is accepted and nothing lands on disk.
    const real = app.ports.files.write.bind(app.ports.files);
    app.ports.files.write = async (target, content, options) =>
      target === file(app!) ? { ok: true, value: null } : real(target, content, options);
    await expect(
      app.invoke('cheat-sheets:trainerRecord', {
        ...HORNET,
        answers: [{ cardId: 'a', right: true }],
      })
    ).rejects.toThrow(/could not be kept/);
  });
});
