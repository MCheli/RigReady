import { defineStore } from 'pinia';
import { ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { streamDeckContract, type Overview } from '../contract';

/** The Stream Deck screens share one overview; every action refreshes it. */
export const useStreamDeckStore = defineStore('stream-deck', () => {
  const api = useClient(streamDeckContract);
  const overview = ref<Overview>();
  const error = ref<string>();
  const loading = ref(false);

  async function load(): Promise<void> {
    loading.value = true;
    const result = await api.overview();
    loading.value = false;
    if (result.ok) {
      overview.value = result.value;
      error.value = undefined;
    } else {
      error.value = errorText(result.error);
    }
  }

  return { api, overview, error, loading, load };
});

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "7.4.2.22730" -> "7.4.2". */
export function shortVersion(version: string | undefined): string | undefined {
  return version?.split('.').slice(0, 3).join('.');
}

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
