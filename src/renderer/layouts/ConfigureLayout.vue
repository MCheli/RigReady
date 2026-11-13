<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, type RouteLocationNormalizedLoaded } from 'vue-router';
import { navSectionsOf } from '../../shared/feature';
import BindingsGamePicker from '../components/BindingsGamePicker.vue';
import { bindingsPages, manifests, places } from '../features';
import { bindingsPageAt } from '../shell/bindings';
import { ariaCurrent, currentEntry } from '../shell/nav';
import { gamesFound, pageEpoch } from '../shell/shell';

/**
 * The page shown, keyed by its route record: moving between the tabs of one page keeps the
 * page, and a command that links to the page already on screen opens it afresh (pageEpoch).
 */
const viewKey = (shown: RouteLocationNormalizedLoaded): string =>
  `${shown.matched[1]?.path ?? ''}:${pageEpoch.value}`;

/**
 * The navigation says where you are on every page, also on one that has no entry of its
 * own: a setup's editor is under Setups, the trainer under Cheat sheets, the DCS World page
 * under Games and a game's bindings under Bindings.
 */
const route = useRoute();

/**
 * The menu offers an entry about a game (the binding guide, for DCS) only while the game is
 * found on this PC, as Games offers a game page's card. Its page still opens from a link.
 */
const navSections = computed(() => navSectionsOf(manifests, gamesFound.value));
const entries = computed(() =>
  navSections.value.flatMap((group) => group.entries.map((entry) => entry.to))
);
const current = computed(() => currentEntry(entries.value, route.path, places));

/** On a game's bindings page, the game picker of Bindings stands above it. */
const bindings = computed(() => bindingsPageAt(bindingsPages, route.path));
</script>

<template>
  <div class="configure">
    <nav class="configure-nav" data-testid="configure-nav" aria-label="Configure">
      <div
        v-for="group in navSections"
        :key="group.section"
        class="configure-group"
        role="group"
        :aria-label="group.section"
      >
        <div class="rr-section-title configure-group-title" aria-hidden="true">
          {{ group.section }}
        </div>
        <router-link
          v-for="entry in group.entries"
          :key="entry.to"
          :to="entry.to"
          class="configure-link"
          :class="{ active: entry.to === current }"
          :aria-current="ariaCurrent(entry.to, current, route.path)"
          :data-testid="`nav-${entry.to.split('/').pop()}`"
        >
          <v-icon :icon="entry.icon" size="17" />
          <span>{{ entry.title }}</span>
        </router-link>
      </div>
    </nav>
    <div class="configure-content">
      <BindingsGamePicker v-if="bindings" :pages="bindingsPages" :current="bindings" />
      <router-view v-slot="{ Component, route: shown }">
        <component :is="Component" :key="viewKey(shown)" />
      </router-view>
    </div>
  </div>
</template>

<style scoped>
.configure {
  display: flex;
  min-height: calc(100vh - 56px);
}
/*
 * Five groups, eighteen entries: sized so all of it is visible at the default window height
 * (tests/e2e/tour.e2e.ts checks that). The page is 821 high there, which leaves 765 for
 * this; eighteen rows of 28 with five headings and what is between them take 683, room for
 * two more. A page about one game or a game's bindings takes no row: it is reached from
 * Games or Bindings (gamePages and bindings in a manifest). A smaller window scrolls, with
 * a thin bar.
 */
.configure-nav {
  width: 208px;
  flex-shrink: 0;
  border-right: 1px solid var(--rr-border);
  background: var(--rr-surface);
  padding: 14px 10px 12px;
  position: sticky;
  top: 56px;
  align-self: flex-start;
  height: calc(100vh - 56px);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--rr-border) transparent;
}
.configure-group {
  margin-bottom: 12px;
}
.configure-group:last-child {
  margin-bottom: 0;
}
.configure-group-title {
  padding: 0 10px;
  margin-bottom: 3px;
}
.configure-link {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  border-radius: 7px;
  color: var(--rr-muted);
  text-decoration: none;
  font-size: 13.5px;
  line-height: 20px;
  transition:
    color var(--rr-motion-fast) var(--rr-ease),
    background-color var(--rr-motion-fast) var(--rr-ease);
}
.configure-link:hover {
  color: var(--rr-text);
  background: color-mix(in srgb, var(--rr-surface-2) 55%, transparent);
}
.configure-link.active {
  background: var(--rr-surface-2);
  color: var(--rr-text);
}
/* Where you are: a thin line as well as a tint, like the index mark on an instrument. */
.configure-link.active::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 0 2px 2px 0;
  background: var(--rr-kind, var(--rr-accent));
}
.configure-content {
  flex: 1;
  min-width: 0;
}
</style>
