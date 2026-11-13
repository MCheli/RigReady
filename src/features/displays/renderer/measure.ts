import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

/**
 * How wide an element is drawn, in px, kept up to date as the window changes. Undefined
 * until it is on the page. A drawing uses it to know which names fit in their boxes.
 */
export function useWidth(target: Ref<HTMLElement | undefined>): Ref<number | undefined> {
  const width = ref<number>();
  let observer: ResizeObserver | undefined;
  onMounted(() => {
    const el = target.value;
    if (!el) return;
    if (el.clientWidth > 0) width.value = el.clientWidth;
    observer = new ResizeObserver((entries) => {
      const now = entries[0]?.contentRect.width;
      if (now !== undefined && now > 0) width.value = Math.round(now);
    });
    observer.observe(el);
  });
  onBeforeUnmount(() => observer?.disconnect());
  return width;
}
