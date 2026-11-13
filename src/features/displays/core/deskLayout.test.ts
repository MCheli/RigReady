import { afterEach, describe, expect, it } from 'vitest';
import { runAsAssistant } from '../../../core/assistantScripts';
import type { ActionReport } from '../../../core/checks/engine';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { DisplaysView } from '../contract';
import { DESK_NOT_KEPT_NEXT_TIME, deskNotKeptYetText } from './deskLayout';

/**
 * Stand down and the desk layout, through IPC as the window and the countdown call them:
 * a layout replaced with the monitors as they are counts as kept with those monitors, the
 * countdown before a Stand down by itself can say when the desk layout will be asked
 * about, and a desk layout that went back says what to do next time.
 */

let app: WiredApp;
afterEach(async () => {
  if (app) {
    // Never leave a countdown timer running into the next test.
    const pending = await app.invoke<{ pending: boolean }>('displays:pending');
    if (pending.pending) await app.invoke('displays:keep');
    await app.cleanup();
  }
});

const P = { profileId: 'dcs-f-a-18c' };
const questions = (): number =>
  app.events.filter((e) => e.channel === 'displays:event:applied').length;
const unasked = (): number =>
  app.events.filter((e) => e.channel === 'displays:event:appliedKnown').length;
const on = (): string[] =>
  app.ports.state.displays
    .filter((d) => d.enabled)
    .map((d) => d.name)
    .sort();

/** What the countdown before a Stand down by itself would say about the desk layout. */
async function deskNeedsYou(): Promise<string | null> {
  const step = app.wiring.context.checks
    .standDownSteps()
    .find((s) => s.id === 'displays.deskLayout');
  if (!step?.needsYou) throw new Error('the desk layout step says nothing before it runs');
  return step.needsYou(app.wiring.context);
}

/** The desk step's line in what Stand down did. */
async function standDown(): Promise<{ ok: boolean; message: string } | undefined> {
  const down = await app.invoke<ActionReport>('fly:standDown', P);
  return down.steps.find((s) => s.itemId === 'displays.deskLayout');
}

/**
 * At the desk, as recorded: the Dell, the ultrawide and the three MFD screens all on. The
 * desk layout "Desk" holds the Dell and the ultrawide only, so it differs from them now.
 */
async function atTheDesk(): Promise<string> {
  app = await wiredApp('desk-mfds-wrong');
  const view = await app.invoke<DisplaysView>('displays:view');
  const stayOn = view.monitors
    .filter((m) => m.enabled && m.name !== 'USB_Monitor')
    .map((m) => m.id);
  const made = await app.invoke<DisplaysView>('displays:newLayout', { name: 'Desk', stayOn });
  const desk = made.layouts.find((l) => l.name === 'Desk')!;
  expect(desk.status).toBe('different');
  await app.invoke('displays:setDeskLayout', { id: desk.id });
  return desk.id;
}

/** Make ready for flying; its own layout is asked about the first time and kept. */
async function makeReady(): Promise<void> {
  const made = await app.invoke<ActionReport>('fly:makeReady', P);
  expect(made.report.ready).toBe(true);
}

describe('Replace with the monitors as they are now', () => {
  it('counts as kept with these monitors: the next Stand down puts that layout back without the question', async () => {
    const id = await atTheDesk();
    const desk = on();
    // Never kept: a Stand down would ask about it, and its countdown would say so.
    await makeReady();
    expect(await deskNeedsYou()).toBe(deskNotKeptYetText('Desk'));
    await app.invoke('displays:revert');
    expect(on()).toEqual(desk);

    // Replaced at the desk, with the monitors in front of the person who pressed it.
    const replaced = await app.invoke<DisplaysView>('displays:updateLayout', { id });
    expect(replaced.layouts.find((l) => l.id === id)!.status).toBe('current');
    const asked = questions();

    // Make ready for flying (kept before), then Stand down: Desk comes back unasked.
    await makeReady();
    expect(on()).not.toEqual(desk);
    expect(await deskNeedsYou()).toBeNull();
    app.layoutAnswer = 'wait';
    expect(await standDown()).toEqual({
      itemId: 'displays.deskLayout',
      title: 'Desk monitor layout',
      ok: true,
      message: 'Applied desk layout "Desk"',
    });
    expect(questions()).toBe(asked);
    expect(unasked()).toBe(2);
    expect(on()).toEqual(desk);
    expect(await app.invoke('displays:pending')).toEqual({ pending: false, seconds: 15 });
  });

  it('does not count when an assistant replaced the layout: it cannot see the screens', async () => {
    const id = await atTheDesk();
    await runAsAssistant('Claude Desktop', () => app.invoke('displays:updateLayout', { id }));
    await makeReady();
    expect(await deskNeedsYou()).toBe(deskNotKeptYetText('Desk'));
    const asked = questions();
    expect(await standDown()).toMatchObject({ ok: true, message: 'Applied desk layout "Desk"' });
    expect(questions()).toBe(asked + 1);
  });
});

describe('a desk layout kept with other monitors (the morning of 13 Nov)', () => {
  it('is asked about again: the countdown says so first, and when it goes back the result says what to do next time', async () => {
    const id = await atTheDesk();
    // Desk replaced with the flight gear connected, the MFD screens among it.
    await app.invoke('displays:updateLayout', { id });
    await makeReady();
    // The racing gear goes on and the three MFD screens are unplugged.
    await mutate(app, [{ op: 'unplugDisplay', match: { name: 'USB_Monitor' } }]);
    const racing = on();
    expect(racing).toEqual(['LC49G95T']);

    // These monitors never kept Desk: the question is still asked, and the countdown says so.
    expect(await deskNeedsYou()).toBe(
      'The desk layout "Desk" has not been kept with these monitors yet. Stay and press Keep it when RigReady asks, or the monitors stay as they are.'
    );
    app.layoutAnswer = 'revert';
    const asked = questions();
    expect(await standDown()).toEqual({
      itemId: 'displays.deskLayout',
      title: 'Desk monitor layout',
      ok: false,
      message: `The new monitor layout was not kept, so the previous one is back. ${DESK_NOT_KEPT_NEXT_TIME}`,
    });
    expect(DESK_NOT_KEPT_NEXT_TIME).toBe('Next time, stay for the question and press Keep it.');
    expect(questions()).toBe(asked + 1);
    expect(on()).toEqual(racing);

    // Kept this time: with these monitors it is not asked about again.
    app.layoutAnswer = 'keep';
    expect(await standDown()).toMatchObject({
      ok: true,
      message: 'Applied desk layout "Desk" (3 monitors are not connected)',
    });
    expect(questions()).toBe(asked + 2);
    await app.invoke('displays:revert');
    expect(on()).toEqual(racing);
    expect(await deskNeedsYou()).toBeNull();
    app.layoutAnswer = 'wait';
    expect(await standDown()).toMatchObject({ ok: true });
    expect(questions()).toBe(asked + 2);
  });

  it('says nothing before a Stand down that has nothing to change, or that will fail and say why', async () => {
    const id = await atTheDesk();
    // Desk is the monitors as they are: nothing to change.
    await app.invoke('displays:updateLayout', { id });
    expect(await deskNeedsYou()).toBeNull();
    // No desk layout chosen.
    await app.invoke('displays:setDeskLayout', { id: null });
    expect(await deskNeedsYou()).toBeNull();
    // The monitors cannot be read: the step will say so when it runs.
    await app.invoke('displays:setDeskLayout', { id });
    await makeReady();
    await mutate(app, [{ op: 'failProvider', port: 'displays' }]);
    expect(await deskNeedsYou()).toBeNull();
  });
});
