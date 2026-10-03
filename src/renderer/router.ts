import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import { featureRoutes, firstConfigurePath } from './features';
import ConfigureLayout from './layouts/ConfigureLayout.vue';
import NotFound from './layouts/NotFound.vue';

const flyRoutes = featureRoutes.filter((r) => r.meta?.mode === 'fly');
const configureRoutes = featureRoutes.filter((r) => r.meta?.mode !== 'fly');

for (const route of configureRoutes) {
  if (!route.path.startsWith('/configure/')) {
    throw new Error(
      `Feature route ${route.path} must start with /configure/ or set meta.mode to 'fly'`
    );
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: flyRoutes[0]?.path ?? '/configure' },
  ...flyRoutes,
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

export const router = createRouter({ history: createWebHashHistory(), routes });
