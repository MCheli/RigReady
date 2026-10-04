import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/**
 * True while Windows is set to show less animation ("Animation effects" off). A picture
 * that would move then shows its two states side by side instead.
 */
export function useReducedMotion(): Ref<boolean> {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = ref(query.matches);
  const update = (): void => {
    reduced.value = query.matches;
  };
  onMounted(() => query.addEventListener('change', update));
  onBeforeUnmount(() => query.removeEventListener('change', update));
  return reduced;
}
