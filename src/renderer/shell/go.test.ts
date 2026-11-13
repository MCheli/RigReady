import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { holdUnsaved, mayDropUnsaved, unsavedOnScreen, type Unsaved } from '../unsaved';
import { goTo } from './go';

const blank = { render: () => null };

async function routerAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: blank },
      { path: '/configure/wheel', component: blank },
      { path: '/configure/cheat-sheets', component: blank },
      { path: '/configure/profiles/:id', component: blank },
    ],
  });
  await router.push(path);
  return router;
}

/** A page part with changes that are not saved, which answers `answer` when asked. */
function editing(answer: boolean): Unsaved & { asked: number } {
  const part = {
    asked: 0,
    dirty: () => true,
    ask: async () => {
      part.asked++;
      return answer;
    },
  };
  return part;
}

let release: (() => void)[] = [];
const hold = (unsaved: Unsaved): void => {
  release.push(holdUnsaved(unsaved));
};
afterEach(() => {
  for (const off of release) off();
  release = [];
});

describe('a command that opens a page (the palette)', () => {
  it('opens another page with a plain navigation, and does not open it afresh', async () => {
    const router = await routerAt('/configure/wheel');
    let afresh = 0;
    await goTo(router, '/configure/cheat-sheets', () => afresh++);
    expect(router.currentRoute.value.fullPath).toBe('/configure/cheat-sheets');
    expect(afresh).toBe(0);
  });

  it('opens the page on screen afresh when nothing on it is unsaved', async () => {
    const router = await routerAt('/configure/cheat-sheets');
    let afresh = 0;
    await goTo(router, '/configure/cheat-sheets?game=dcs&aircraft=FA-18C_hornet', () => afresh++);
    expect(router.currentRoute.value.fullPath).toBe(
      '/configure/cheat-sheets?game=dcs&aircraft=FA-18C_hornet'
    );
    expect(afresh).toBe(1);
    // The very address on screen too: the page reads it again.
    await goTo(router, '/configure/cheat-sheets?game=dcs&aircraft=FA-18C_hornet', () => afresh++);
    expect(afresh).toBe(2);
  });

  it('leaves the page on screen as it is when the link is its own address and changes are unsaved', async () => {
    const router = await routerAt('/configure/wheel');
    const presets = editing(true);
    hold(presets);
    let afresh = 0;
    await goTo(router, '/configure/wheel', () => afresh++);
    expect(afresh).toBe(0);
    expect(presets.asked).toBe(0);
    expect(router.currentRoute.value.fullPath).toBe('/configure/wheel');
  });

  it('asks before it opens the page afresh on another address, and keeps the changes when told to', async () => {
    const router = await routerAt('/configure/cheat-sheets');
    const layout = editing(false);
    hold(layout);
    let afresh = 0;
    await goTo(router, '/configure/cheat-sheets?game=dcs&aircraft=FA-18C_hornet', () => afresh++);
    expect(layout.asked).toBe(1);
    expect(afresh).toBe(0);
    expect(router.currentRoute.value.fullPath).toBe('/configure/cheat-sheets');
  });

  it('opens the page afresh on the new address once the user lets the changes go', async () => {
    const router = await routerAt('/configure/cheat-sheets');
    const layout = editing(true);
    hold(layout);
    let afresh = 0;
    await goTo(router, '/configure/cheat-sheets?game=dcs&aircraft=FA-18C_hornet', () => afresh++);
    expect(layout.asked).toBe(1);
    expect(afresh).toBe(1);
    expect(router.currentRoute.value.query['aircraft']).toBe('FA-18C_hornet');
  });

  it('does not open the page afresh when a guard of the page keeps it where it is', async () => {
    const router = await routerAt('/configure/profiles/a');
    // The setup editor's own guard, for a move to another setup.
    router.beforeEach((to, from) => to.path === from.path || to.params['id'] !== 'b');
    let afresh = 0;
    await goTo(router, '/configure/profiles/b', () => afresh++);
    expect(router.currentRoute.value.fullPath).toBe('/configure/profiles/a');
    expect(afresh).toBe(0);
  });
});

describe('the changes on screen that are not saved', () => {
  it('counts only the parts that hold unsaved changes, and only while they are held', () => {
    const clean: Unsaved = { dirty: () => false, ask: async () => true };
    hold(clean);
    expect(unsavedOnScreen()).toBe(false);
    const off = holdUnsaved(editing(true));
    expect(unsavedOnScreen()).toBe(true);
    off();
    expect(unsavedOnScreen()).toBe(false);
  });

  it('asks each part with changes in turn and stops at the first the user keeps', async () => {
    const first = editing(true);
    const kept = editing(false);
    const last = editing(true);
    const clean = { ...editing(true), dirty: () => false };
    for (const part of [first, clean, kept, last]) hold(part);
    expect(await mayDropUnsaved()).toBe(false);
    expect([first.asked, clean.asked, kept.asked, last.asked]).toEqual([1, 0, 1, 0]);
  });

  it('may drop everything when nothing on screen is unsaved', async () => {
    hold({ dirty: () => false, ask: async () => false });
    expect(await mayDropUnsaved()).toBe(true);
  });
});
