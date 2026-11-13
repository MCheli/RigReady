<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { onBeforeRouteLeave, useRouter, type RouteLocationRaw } from 'vue-router';

/**
 * The bar at the bottom of an editor. Save and Back stay in view however far the page is
 * scrolled, and the bar says whether there are changes that are not saved yet. Leaving
 * with unsaved changes, by Back or by any other way out of the page, asks first.
 *
 * Put it last inside the page's `.rr-page`. The page keeps the saving itself: it hands in
 * `dirty` (what is on screen differs from what was saved), and saves on `save`.
 *
 * While the bar is on screen it sets `--rr-save-bar-height` on the document, so anything
 * pinned to the bottom of the window (the running badge of the virtual controller) can sit
 * above it with `calc(16px + var(--rr-save-bar-height, 0px))`.
 */
const props = withDefaults(
  defineProps<{
    /** What is on screen differs from what was saved. */
    dirty: boolean;
    /** A save is under way. */
    saving?: boolean;
    /** Why Save cannot be pressed now, in words. Save is off while this is set. */
    blocked?: string;
    /** What went wrong with the last save. */
    error?: string;
    /** What the last save did ("Saved My HOTAS"), shown until the next change. */
    saved?: string;
    saveLabel?: string;
    backLabel?: string;
    /** Where Back goes. */
    backTo: RouteLocationRaw;
  }>(),
  {
    saving: false,
    blocked: undefined,
    error: undefined,
    saved: undefined,
    saveLabel: 'Save',
    backLabel: 'Back',
  }
);
const emit = defineEmits<{ save: [] }>();

const router = useRouter();
/** Where the user was going when the bar asked about unsaved changes. */
const asking = ref<RouteLocationRaw>();
let letGo = false;

onBeforeRouteLeave((to) => {
  if (!props.dirty || letGo) return true;
  asking.value = to.fullPath;
  return false;
});

function leave(): void {
  const to = asking.value;
  asking.value = undefined;
  if (to === undefined) return;
  letGo = true;
  void router.push(to);
}

const bar = ref<HTMLElement>();
let watcher: ResizeObserver | undefined;
const HEIGHT = '--rr-save-bar-height';
onMounted(() => {
  const el = bar.value;
  if (!el) return;
  /** The column the page stands in: beside the menu in Configure, the whole window in Play. */
  const column = el.closest('.rr-page')?.parentElement;
  const measure = (): void => {
    document.documentElement.style.setProperty(HEIGHT, `${el.offsetHeight}px`);
    if (!column) return;
    // How far that column reaches past the bar on each side: the bar's surface is carried
    // on that far and no further, so it never lies over the menu.
    const own = el.getBoundingClientRect();
    const around = column.getBoundingClientRect();
    el.style.setProperty('--rr-save-bar-left', `${Math.max(0, own.left - around.left)}px`);
    el.style.setProperty('--rr-save-bar-right', `${Math.max(0, around.right - own.right)}px`);
  };
  measure();
  watcher = new ResizeObserver(measure);
  watcher.observe(el);
  if (column) watcher.observe(column);
});
onBeforeUnmount(() => {
  watcher?.disconnect();
  document.documentElement.style.removeProperty(HEIGHT);
});
</script>

<template>
  <div
    ref="bar"
    class="rr-save-bar"
    role="group"
    aria-label="Save or go back"
    data-testid="save-bar"
  >
    <div class="rr-save-bar-state" role="status" data-testid="save-bar-state">
      <span v-if="error" class="rr-bad" data-testid="save-bar-error">
        <v-icon icon="mdi-close-circle" size="16" /> {{ error }}
      </span>
      <span v-else-if="dirty" class="rr-warn" data-testid="save-bar-unsaved">
        <v-icon icon="mdi-circle-medium" size="16" /> Unsaved changes
      </span>
      <span v-else-if="saved" class="rr-ok" data-testid="save-bar-saved">
        <v-icon icon="mdi-check-circle" size="16" /> {{ saved }}
      </span>
      <span v-else class="rr-muted" data-testid="save-bar-clean">No unsaved changes</span>
      <span v-if="blocked" class="rr-save-bar-why" data-testid="save-bar-why">{{ blocked }}</span>
    </div>
    <v-btn variant="text" data-testid="save-bar-back" @click="router.push(backTo)">{{
      backLabel
    }}</v-btn>
    <v-btn
      color="primary"
      variant="flat"
      :disabled="blocked !== undefined"
      :loading="saving"
      data-testid="save-bar-save"
      @click="emit('save')"
      >{{ saveLabel }}</v-btn
    >

    <v-dialog
      :model-value="asking !== undefined"
      max-width="440"
      @update:model-value="asking = undefined"
    >
      <v-card data-testid="save-bar-leave">
        <v-card-title>Leave without saving?</v-card-title>
        <v-card-text>Your changes on this page are not saved. Leaving drops them.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="save-bar-leave-go" @click="leave"
            >Leave without saving</v-btn
          >
          <v-btn
            color="primary"
            variant="flat"
            data-testid="save-bar-leave-stay"
            @click="asking = undefined"
            >Keep editing</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.rr-save-bar {
  position: sticky;
  bottom: 0;
  /* Above the page's own content, below dialogs, the running badge and toasts. */
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
  /*
   * Over the page's own padding (.rr-page: 32px at the sides, 48px below), so the bar sits
   * on the bottom edge of the window at the end of the page too, not 48px above it.
   */
  margin: 20px -32px -48px;
  padding: 10px 32px;
  background: var(--rr-surface);
  border-top: 1px solid var(--rr-border-strong);
  /*
   * The same surface and top line carried on to both edges of the column the page stands
   * in, when the window is wider than the page (the script measures how far that is). A
   * border image may be drawn outside its box and never makes the page scroll sideways.
   */
  border-image: linear-gradient(
      to bottom,
      var(--rr-border-strong) 0 1px,
      var(--rr-surface) 1px 100%
    )
    fill 0 / 0 / 0 var(--rr-save-bar-right, 0px) 0 var(--rr-save-bar-left, 0px);
}
.rr-save-bar-state {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 14px;
  font-size: var(--rr-text-sm);
}
.rr-save-bar-why {
  color: var(--rr-text-2);
}
</style>
