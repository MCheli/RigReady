import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import { BINDINGS_ENTRY, type FoundGames } from '../shared/feature';
import { bindingsPages, featureCommands, featureRoutes, firstConfigurePath } from './features';
import ConfigureLayout from './layouts/ConfigureLayout.vue';
import NoBindings from './layouts/NoBindings.vue';
import NotFound from './layouts/NotFound.vue';
import { bindingsPageAt, bindingsTarget, setupGameOf, windowMemory } from './shell/bindings';
import { gamesFoundBy } from './shell/games';
import { scrollOnMove } from './shell/nav';
import { routeKinds } from './shell/routes';
import { createCommandShell, gamesFoundNow } from './shell/shell';

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
 * The games found on this PC as Bindings is opened: the ones the menu follows, or asked
 * now when Bindings is opened before their first answer. Undefined: cannot be told.
 */
const foundNow = (): Promise<FoundGames> =>
  gamesFoundNow(async () => {
    try {
      return await gamesFoundBy(await featureCommands(), createCommandShell(router));
    } catch {
      // The command modules did not load: every game's bindings are offered, as the menu does.
      return undefined;
    }
  });

/**
 * The menu's Bindings entry: it has no page of its own and opens the bindings page of the
 * game shown last, or on first use of the setup's game, among the games found on this PC.
 * Where none of them is found it says so (NoBindings). The address stays valid for links
 * and the palette; `meta.forwards` tells a walk through every route that it lands elsewhere
 * wherever a game with bindings is found.
 */
const bindingsRoute: RouteRecordRaw[] =
  bindingsPages.length === 0
    ? []
    : [
        {
          path: BINDINGS_ENTRY.to.slice('/configure/'.length),
          // Drawn only on a PC without any of those games; elsewhere the guard sends on.
          component: NoBindings,
          meta: { forwards: true },
          beforeEnter: async (to) => {
            const page = await bindingsTarget(
              bindingsPages,
              windowMemory,
              setupGame,
              await foundNow()
            );
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

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: (to, from, saved) => scrollOnMove(to.path, from.path, saved),
});

// The game whose bindings were on screen last, whether chosen in the picker or opened by a
// link: Bindings opens it next time.
router.afterEach((to, _from, failure) => {
  if (failure) return;
  const page = bindingsPageAt(bindingsPages, to.path);
  if (page) windowMemory.write(page.game);
});
