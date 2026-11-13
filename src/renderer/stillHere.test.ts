import { describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { stillHereOn } from './stillHere';

const blank = { render: () => null };

async function routerAt(path: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: blank },
      { path: '/configure/profiles', component: blank },
      { path: '/configure/profiles/:id', component: blank },
      { path: '/configure/displays', component: blank },
    ],
  });
  await router.push(path);
  return router;
}

describe('whether a page may still move the user on once main has answered', () => {
  it('yes, while the user is on the page where they pressed the button', async () => {
    const router = await routerAt('/configure/profiles');
    const here = stillHereOn(router, () => false)();
    expect(here()).toBe(true);
  });

  it('no, once the user went on to another page before the answer came', async () => {
    const router = await routerAt('/configure/profiles');
    const here = stillHereOn(router, () => false)();
    await router.push('/configure/displays');
    expect(here()).toBe(false);
  });

  it('no, after a move to the same kind of page for something else (another setup)', async () => {
    const router = await routerAt('/configure/profiles/a');
    const here = stillHereOn(router, () => false)();
    await router.push('/configure/profiles/b');
    expect(here()).toBe(false);
  });

  it('no, when the page that asked was left and opened afresh in the meantime', async () => {
    const router = await routerAt('/configure/profiles');
    let gone = false;
    const here = stillHereOn(router, () => gone)();
    await router.push('/configure/displays');
    gone = true;
    await router.push('/configure/profiles');
    expect(here()).toBe(false);
  });
});
