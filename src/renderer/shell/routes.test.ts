import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import { describe, expect, it } from 'vitest';
import { opensBare, routeKinds } from './routes';

const blank = { render: () => null };

const ROUTES: RouteRecordRaw[] = [
  { path: '/fly', component: blank, meta: { mode: 'fly' } },
  { path: '/configure/overlay', component: blank },
  { path: '/overlay/:widget', component: blank, meta: { bare: true } },
  { path: '/configure/devices', component: blank },
];

describe('where a feature route is shown', () => {
  it('sorts the routes into Play, Configure and windows of their own', () => {
    const kinds = routeKinds(ROUTES);
    expect(kinds.fly.map((r) => r.path)).toEqual(['/fly']);
    expect(kinds.bare.map((r) => r.path)).toEqual(['/overlay/:widget']);
    expect(kinds.configure.map((r) => r.path)).toEqual([
      '/configure/overlay',
      '/configure/devices',
    ]);
  });

  it('refuses a page that says nothing about itself and is not under /configure/', () => {
    expect(() => routeKinds([{ path: '/somewhere', component: blank }])).toThrow(/\/configure\//);
  });

  it('refuses a bare page that hides among the pages of Configure, or has no address', () => {
    const bare = (path: string): RouteRecordRaw => ({
      path,
      component: blank,
      meta: { bare: true },
    });
    expect(() => routeKinds([bare('/configure/overlay/window')])).toThrow(/top-level/);
    expect(() => routeKinds([bare('overlay')])).toThrow(/top-level/);
  });
});

describe('whether a window was opened on a bare page', () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [...ROUTES, { path: '/:rest(.*)*', component: blank }],
  });
  const resolve = (path: string) => router.resolve(path);

  it('is so for the address of a bare page, with or without the leading #', () => {
    expect(opensBare('#/overlay/recent-presses', resolve)).toBe(true);
    expect(opensBare('/overlay/recent-presses', resolve)).toBe(true);
  });

  it('is not so for the main window, a page of the app, or an address that is none', () => {
    expect(opensBare('', resolve)).toBe(false);
    expect(opensBare('#', resolve)).toBe(false);
    expect(opensBare('#/fly', resolve)).toBe(false);
    expect(opensBare('#/configure/overlay', resolve)).toBe(false);
    expect(opensBare('#/nowhere', resolve)).toBe(false);
  });
});
