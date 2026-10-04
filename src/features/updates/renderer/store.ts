import { defineStore } from 'pinia';
import { ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { updatesContract, type UpdateStatus } from '../contract';

/** The updater's status, kept current by the main side's events. Shared by Updates and About. */
export const useUpdatesStore = defineStore('updates', () => {
  const api = useClient(updatesContract);
  const status = ref<UpdateStatus>();
  const error = ref<string>();
  let listening = false;

  async function load(): Promise<void> {
    if (!listening) {
      listening = true;
      api.on('status', (next) => {
        status.value = next;
      });
    }
    const result = await api.status();
    if (result.ok) status.value = result.value;
    else error.value = errorText(result.error);
  }

  async function act(
    call: () => ReturnType<typeof api.status>,
    refusal?: (code: string) => boolean
  ): Promise<void> {
    error.value = undefined;
    const result = await call();
    if (result.ok) {
      status.value = result.value;
      return;
    }
    // A refusal the status already explains (a game is running) is not shown twice.
    if (refusal?.(result.error.code)) {
      const now = await api.status();
      if (now.ok) status.value = now.value;
      return;
    }
    error.value = errorText(result.error);
  }

  return {
    status,
    error,
    load,
    check: () => act(() => api.check()),
    install: () =>
      act(
        () => api.install(),
        (code) => code === 'update.gameRunning'
      ),
    setAutomatic: (automatic: boolean) => act(() => api.setPreferences({ automatic })),
    setChannel: (channel: 'stable' | 'beta') => act(() => api.setPreferences({ channel })),
  };
});
