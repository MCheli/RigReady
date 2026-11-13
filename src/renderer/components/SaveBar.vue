<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { onBeforeRouteLeave, useRouter, type RouteLocationRaw } from 'vue-router';
import { useUnsaved, wayOut } from '../unsaved';

/**
 * The bar at the bottom of a page with something to keep. Its button (Save, Import, "Use in
 * DCS") and Back stay in view however far the page is scrolled, and the bar says whether
 * there are changes that are not saved yet. Leaving with unsaved changes, by Back or by any
 * other way out of the page, asks first; so does a command that would open this page afresh
 * (the palette's link to the page on screen, `shell/go.ts`). While a save runs Back is off,
 * and a way out by the menu says that the save goes on.
 *
 * Put it last inside the page's `.rr-page`, or last inside a plain block that is itself the
 * last thing in the page (a tab, a panel of the page): the bar stays in view for as long as
 * that block is. The page keeps the saving itself: it hands in `dirty` (what is on screen
 * differs from what was saved), and saves on `save`.
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
    /** Save is off and the reason needs no words: there is nothing to save yet. */
    disabled?: boolean;
    /** What went wrong with the last save. */
    error?: string;
    /** What the last save did ("Saved My HOTAS"), shown until the next change. */
    saved?: string;
    saveLabel?: string;
    backLabel?: string;
    /** Where Back goes. Without it, and without a `back` listener, the bar has no Back. */
    backTo?: RouteLocationRaw;
    /** `@back`: what Back does where the way back is not a route (a panel that closes). */
    onBack?: () => void;
    /** The words for the two states, where "unsaved changes" would be the wrong ones. */
    unsavedLabel?: string;
    cleanLabel?: string;
    /**
     * False where "not saved" does not mean the user changed something (a proposal the page
     * made itself counts too): then nothing is asked on the way out.
     */
    askBeforeLeaving?: boolean;
    /** The test ids of the two buttons, for a page whose tests know them by its own names. */
    saveTestid?: string;
    backTestid?: string;
  }>(),
  {
    saving: false,
    blocked: undefined,
    disabled: false,
    error: undefined,
    saved: undefined,
    saveLabel: 'Save',
    backLabel: 'Back',
    backTo: undefined,
    onBack: undefined,
    unsavedLabel: 'Unsaved changes',
    cleanLabel: 'No unsaved changes',
    askBeforeLeaving: true,
    saveTestid: 'save-bar-save',
    backTestid: 'save-bar-back',
  }
);
const emit = defineEmits<{ save: [] }>();

const router = useRouter();
/** The status line says why Save is off (nothing to save, or the reason); it describes the button. */
const stateId = `rr-save-bar-state-${useId()}`;
const hasBack = computed(() => props.backTo !== undefined || props.onBack !== undefined);
/** What the two buttons are, for a screen reader: "Save or go back", "Import or cancel". */
const label = computed(() => {
  if (!hasBack.value) return props.saveLabel;
  const back = props.backLabel === 'Back' ? 'go back' : props.backLabel.toLowerCase();
  return `${props.saveLabel} or ${back}`;
});
/**
 * Set while the bar asks about unsaved changes: the route the user was going to, no route
 * when it was the page's own Back, or the answer a command waits for before it opens this
 * page afresh.
 */
const asking = ref<{ to?: RouteLocationRaw; answer?: (leave: boolean) => void }>();
/** The way out the user agreed to: let through while it is under way, and only then. */
const way = wayOut(router);
const unsaved = (): boolean => props.dirty && props.askBeforeLeaving && !way.open();

onBeforeRouteLeave((to) => {
  if (!unsaved()) return true;
  asking.value = { to: to.fullPath };
  return false;
});

// The page opened afresh by a command (the palette) runs no route guard: it asks here.
useUnsaved({
  dirty: unsaved,
  ask: () =>
    new Promise<boolean>((answer) => {
      asking.value?.answer?.(false);
      asking.value = { answer };
    }),
});

function back(): void {
  if (props.backTo !== undefined) {
    // The guard above asks, when there is something to ask.
    void router.push(props.backTo);
    return;
  }
  if (props.dirty && props.askBeforeLeaving) asking.value = {};
  else props.onBack?.();
}

function leave(): void {
  const going = asking.value;
  asking.value = undefined;
  if (!going) return;
  if (going.answer) {
    // The command opens this page afresh: that move runs no guard of this bar's.
    going.answer(true);
    return;
  }
  if (going.to === undefined) {
    props.onBack?.();
    return;
  }
  void way.go(going.to);
}

/** "Keep editing", or the question closed: nothing is dropped. */
function stay(): void {
  asking.value?.answer?.(false);
  asking.value = undefined;
}

/**
 * One press, one save. While a save runs the button shows that it is busy, but Vuetify's
 * busy button still takes Enter and Space from the keyboard: that is not a second save.
 */
function save(): void {
  if (props.saving) return;
  emit('save');
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
  // A command still waiting for an answer is told that nothing was dropped.
  asking.value?.answer?.(false);
  watcher?.disconnect();
  document.documentElement.style.removeProperty(HEIGHT);
});
</script>

<template>
  <div ref="bar" class="rr-save-bar" role="group" :aria-label="label" data-testid="save-bar">
    <div :id="stateId" class="rr-save-bar-state" role="status" data-testid="save-bar-state">
      <span v-if="error" class="rr-bad" data-testid="save-bar-error">
        <v-icon icon="mdi-close-circle" size="16" /> {{ error }}
      </span>
      <span v-else-if="dirty" class="rr-warn" data-testid="save-bar-unsaved">
        <v-icon icon="mdi-circle-medium" size="16" /> {{ unsavedLabel }}
      </span>
      <span v-else-if="saved" class="rr-ok" data-testid="save-bar-saved">
        <v-icon icon="mdi-check-circle" size="16" /> {{ saved }}
      </span>
      <span v-else class="rr-muted" data-testid="save-bar-clean">{{ cleanLabel }}</span>
      <span v-if="blocked" class="rr-save-bar-why" data-testid="save-bar-why">{{ blocked }}</span>
    </div>
    <!-- Off while a save runs: what Back would leave or close is what is being saved. -->
    <v-btn
      v-if="hasBack"
      variant="text"
      :disabled="saving"
      :data-testid="backTestid"
      @click="back"
      >{{ backLabel }}</v-btn
    >
    <v-btn
      color="primary"
      variant="flat"
      :disabled="disabled || blocked !== undefined"
      :aria-describedby="stateId"
      :loading="saving"
      :data-testid="saveTestid"
      @click="save"
      >{{ saveLabel }}</v-btn
    >

    <v-dialog :model-value="asking !== undefined" max-width="440" @update:model-value="stay">
      <v-card data-testid="save-bar-leave">
        <v-card-title>Leave without saving?</v-card-title>
        <!-- A save under way goes on in RigReady whether the page stays or not. -->
        <v-card-text v-if="saving" data-testid="save-bar-leave-saving"
          >The save you started goes on. Changes made after you pressed {{ saveLabel }} are not in
          it, and leaving drops them.</v-card-text
        >
        <v-card-text v-else
          >Your changes on this page are not saved. Leaving drops them.</v-card-text
        >
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="save-bar-leave-go" @click="leave"
            >Leave without saving</v-btn
          >
          <v-btn color="primary" variant="flat" data-testid="save-bar-leave-stay" @click="stay"
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
