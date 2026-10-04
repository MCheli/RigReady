<script setup lang="ts">
import { computed } from 'vue';

/**
 * The one way a page says that a game or tool it is about is not on this PC: what is
 * missing, where RigReady looked, and what to do. Every page that depends on a game uses
 * it, so the wording is the same everywhere.
 *
 *   <NotOnThisPc name="iRacing" :looked="['every Steam library', 'Documents\\iRacing']"
 *     game-page="/configure/games/iracing" />
 *
 * The default slot replaces the "what to do" sentence; `action` holds a button.
 */
const props = defineProps<{
  /** "iRacing", "DCS World". */
  name: string;
  /** Places RigReady looked, each fitting after "looked in": "every Steam library". */
  looked?: string[];
  /** Route of the game's page, when a folder can be chosen there by hand. */
  gamePage?: string;
  /** A row inside a panel rather than a panel of its own. */
  inline?: boolean;
}>();

const lookedText = computed(() => {
  const places = props.looked ?? [];
  if (places.length === 0) return '';
  if (places.length === 1) return places[0]!;
  return `${places.slice(0, -1).join(', ')} and ${places[places.length - 1]}`;
});
</script>

<template>
  <div
    class="not-here"
    :class="inline ? 'not-here-inline' : 'rr-panel'"
    role="status"
    data-testid="not-on-this-pc"
  >
    <v-icon icon="mdi-magnify-remove-outline" :size="inline ? 22 : 34" class="not-here-icon" />
    <div class="not-here-text">
      <div class="not-here-title" data-testid="not-here-title">
        {{ name }} was not found on this PC
      </div>
      <div v-if="lookedText" class="not-here-line" data-testid="not-here-looked">
        RigReady looked in {{ lookedText }}.
      </div>
      <div class="not-here-line" data-testid="not-here-next">
        <slot>
          Install {{ name }} and start it once; this page then fills in by itself.
          <template v-if="gamePage">
            If it is installed somewhere else, choose its folder on the
            <router-link :to="gamePage" data-testid="not-here-game-page"
              >{{ name }} game page</router-link
            >.
          </template>
        </slot>
      </div>
    </div>
    <div v-if="$slots.action" class="not-here-action"><slot name="action" /></div>
  </div>
</template>

<style scoped>
.not-here {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 44px 24px;
  color: var(--rr-muted);
}
.not-here-icon {
  margin-bottom: 6px;
}
.not-here-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--rr-text);
}
.not-here-line {
  font-size: 13.5px;
  max-width: 640px;
  line-height: 1.5;
}
.not-here-action {
  margin-top: 10px;
}
.not-here-inline {
  flex-direction: row;
  align-items: center;
  text-align: left;
  gap: 14px;
  padding: 12px 16px;
}
.not-here-inline .not-here-icon {
  margin-bottom: 0;
}
.not-here-inline .not-here-text {
  flex: 1;
  min-width: 0;
}
.not-here-inline .not-here-title {
  font-size: 14px;
}
.not-here-inline .not-here-line {
  font-size: 12.5px;
  max-width: none;
}
.not-here-inline .not-here-action {
  margin-top: 0;
}
</style>
