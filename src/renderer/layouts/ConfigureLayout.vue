<script setup lang="ts">
import { navSections } from '../features';
</script>

<template>
  <div class="configure">
    <aside class="configure-nav" data-testid="configure-nav">
      <div v-for="group in navSections" :key="group.section" class="configure-group">
        <div class="rr-section-title configure-group-title">{{ group.section }}</div>
        <router-link
          v-for="entry in group.entries"
          :key="entry.to"
          :to="entry.to"
          class="configure-link"
          active-class="active"
          :data-testid="`nav-${entry.to.split('/').pop()}`"
        >
          <v-icon :icon="entry.icon" size="18" />
          <span>{{ entry.title }}</span>
        </router-link>
      </div>
    </aside>
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
.configure-nav {
  width: 216px;
  flex-shrink: 0;
  border-right: 1px solid var(--rr-border);
  background: var(--rr-surface);
  padding: 20px 10px;
}
.configure-group {
  margin-bottom: 20px;
}
.configure-group-title {
  padding: 0 10px;
}
.configure-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 7px;
  color: var(--rr-muted);
  text-decoration: none;
  font-size: 14px;
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
