import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import { BINDINGS_ENTRY } from '../shared/feature';
import { bindingsPages, featureCommands, featureRoutes, firstConfigurePath } from './features';
import ConfigureLayout from './layouts/ConfigureLayout.vue';
import NotFound from './layouts/NotFound.vue';
import { bindingsPageAt, bindingsTarget, setupGameOf, windowMemory } from './shell/bindings';
import { routeKinds } from './shell/routes';
import { createCommandShell } from './shell/shell';

const { fly: flyRoutes, bare: bareRoutes, configure: configureRoutes } = routeKinds(featureRoutes);

/** The game of the setup in use, from the features that know (asked only on first use). */
async function setupGame(): Promise<string | undefined> {
  try {
    return await setupGameOf(await featureCommands(), createCommandShell(router));
  } catch {
    // The command modules did not load (the palette reports that when it is opened):
    // Bindings opens on the first game of the picker.
    return undefined;
  }
}

/**
 * The menu's Bindings entry: it has no page of its own and opens the bindings page of the
 * game shown last, or on first use of the setup's game. The address stays valid for links
 * and the palette; `meta.forwards` tells a walk through every route that it lands elsewhere.
 */
const bindingsRoute: RouteRecordRaw[] =
  bindingsPages.length === 0
    ? []
    : [
        {
          path: BINDINGS_ENTRY.to.slice('/configure/'.length),
          // Never drawn: the guard always sends on, to one of the pages above.
          component: NotFound,
          meta: { forwards: true },
          beforeEnter: async (to) => {
            const page = await bindingsTarget(bindingsPages, windowMemory, setupGame);
            return page ? { path: page.to, query: to.query, hash: to.hash } : true;
          },
        },
      ];

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: flyRoutes[0]?.path ?? '/configure' },
  ...flyRoutes,
  // Windows of their own (an overlay over a game): main.ts mounts them without the shell.
  ...bareRoutes,
  {
    path: '/configure',
    component: ConfigureLayout,
    meta: { mode: 'configure' },
    ...(firstConfigurePath ? { redirect: firstConfigurePath } : {}),
    children: [
      ...configureRoutes.map((route) => ({
        ...route,
        path: route.path.slice('/configure/'.length),
      })),
      ...bindingsRoute,
    ] as RouteRecordRaw[],
  },
  { path: '/:rest(.*)*', component: NotFound },
];

export const router = createRouter({ history: createWebHashHistory(), routes });

// The game whose bindings were on screen last, whether chosen in the picker or opened by a
// link: Bindings opens it next time.
router.afterEach((to, _from, failure) => {
  if (failure) return;
  const page = bindingsPageAt(bindingsPages, to.path);
  if (page) windowMemory.write(page.game);
});
