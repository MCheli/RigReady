import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { wayOut, type WayOut } from './unsaved';

const blank = { render: () => null };

/**
 * A router with an editor whose guard asks before any way out, as the Save bar's and the
 * setup editor's do: it lets a move through only while the way the user agreed to is open.
 * `asked` counts the questions.
 */
async function editorOpen(): Promise<{ router: Router; way: WayOut; asked: () => number }> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/configure/profiles/:id', component: blank },
      { path: '/configure/devices', component: blank },
      { path: '/configure/bindings', redirect: '/configure/dcs-bindings' },
      { path: '/configure/dcs-bindings', component: blank },
    ],
  });
  await router.push('/configure/profiles/dcs-f-a-18c');
  const way = wayOut(router);
  let asked = 0;
  router.beforeEach((_to, from) => {
    if (!from.path.startsWith('/configure/profiles/') || way.open()) return true;
    asked++;
    return false;
  });
  return { router, way, asked: () => asked };
}

describe('the way out the user agreed to (Leave without saving, Discard)', () => {
  it('is let through, a redirect on the way included, and asks nothing', async () => {
    const { router, way, asked } = await editorOpen();
    await way.go('/configure/bindings');
    expect(router.currentRoute.value.fullPath).toBe('/configure/dcs-bindings');
    expect(asked()).toBe(0);
    expect(way.open()).toBe(false);
  });

  it('is agreed to once: when the move is stopped elsewhere, the next way out asks again', async () => {
    const { router, way, asked } = await editorOpen();
    // Another guard stops this one move (a second part of the page that keeps editing).
    let stopOnce = true;
    router.beforeEach(() => {
      if (!stopOnce) return true;
      stopOnce = false;
      return false;
    });
    await way.go('/configure/devices');
    expect(router.currentRoute.value.fullPath).toBe('/configure/profiles/dcs-f-a-18c');
    expect(way.open()).toBe(false);
    // The user leaves again by the menu, later: the editor asks, and nothing moves.
    await router.push('/configure/devices');
    expect(asked()).toBe(1);
    expect(router.currentRoute.value.fullPath).toBe('/configure/profiles/dcs-f-a-18c');
  });

  it('is closed again when the move fails', async () => {
    const { router, way } = await editorOpen();
    router.beforeEach((to) => {
      if (to.path === '/configure/devices') throw new Error('a guard broke');
      return true;
    });
    await expect(way.go('/configure/devices')).rejects.toThrow('a guard broke');
    expect(way.open()).toBe(false);
  });
});
