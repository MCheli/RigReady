import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import { featureRoutes, firstConfigurePath } from './features';
import ConfigureLayout from './layouts/ConfigureLayout.vue';
import NotFound from './layouts/NotFound.vue';
import { scrollOnMove } from './shell/nav';
import { routeKinds } from './shell/routes';

const { fly: flyRoutes, bare: bareRoutes, configure: configureRoutes } = routeKinds(featureRoutes);

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
    children: configureRoutes.map((route) => ({
      ...route,
      path: route.path.slice('/configure/'.length),
    })) as RouteRecordRaw[],
  },
  { path: '/:rest(.*)*', component: NotFound },
];

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: (to, from, saved) => scrollOnMove(to.path, from.path, saved),
});
