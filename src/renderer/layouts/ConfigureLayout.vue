<script setup lang="ts">
import { navSections } from '../features';
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
          active-class="active"
          :data-testid="`nav-${entry.to.split('/').pop()}`"
        >
          <v-icon :icon="entry.icon" size="17" />
          <span>{{ entry.title }}</span>
        </router-link>
      </div>
    </nav>
    <div class="configure-content">
      <router-view />
    </div>
  </div>
</template>

<style scoped>
.configure {
  display: flex;
  min-height: calc(100vh - 56px);
}
/*
 * Five groups, about eighteen entries: sized so all of it is visible at the default window
 * height (tests/e2e/tour.e2e.ts checks that). A smaller window scrolls, with a thin bar.
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
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 5px 10px;
  border-radius: 7px;
  color: var(--rr-muted);
  text-decoration: none;
  font-size: 13.5px;
  line-height: 20px;
}
.configure-link:hover {
  color: var(--rr-text);
}
.configure-link.active {
  background: var(--rr-surface-2);
  color: var(--rr-text);
}
.configure-content {
  flex: 1;
  min-width: 0;
}
</style>
