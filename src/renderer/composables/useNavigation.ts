/**
 * Navigation composable for inter-view navigation
 * Uses provide/inject pattern for parent-child communication
 */

import { ref, provide, inject, type InjectionKey, type Ref } from 'vue';

export interface NavigationState {
  targetSection: string | null;
  targetDeviceId: string | null;
}

export interface NavigationApi {
  state: Ref<NavigationState>;
  navigateToInputTester: (deviceId: string) => void;
  clearNavigationState: () => void;
}

const NavigationKey: InjectionKey<NavigationApi> = Symbol('navigation');

/**
 * Create navigation provider (used in App.vue)
 */
export function createNavigation(setCurrentSection: (section: string) => void): NavigationApi {
  const state = ref<NavigationState>({
    targetSection: null,
    targetDeviceId: null,
  });

  function navigateToInputTester(deviceId: string) {
    state.value = {
      targetSection: 'input-test',
      targetDeviceId: deviceId,
    };
    setCurrentSection('input-test');
  }

  function clearNavigationState() {
    state.value = {
      targetSection: null,
      targetDeviceId: null,
    };
  }

  const api: NavigationApi = {
    state,
    navigateToInputTester,
    clearNavigationState,
  };

  provide(NavigationKey, api);

  return api;
}

/**
 * Use navigation in child components
 */
export function useNavigation(): NavigationApi {
  const navigation = inject(NavigationKey);
  if (!navigation) {
    throw new Error('useNavigation must be used within a navigation provider');
  }
  return navigation;
}
