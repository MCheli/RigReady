<script setup lang="ts">
/**
 * The four device tools as tabs. Each tool page places this under its own title and
 * description, the same order every other tabbed page uses (title, what it is for, tabs).
 */
const tabs = [
  { to: '/configure/devices', label: 'Devices', icon: 'mdi-format-list-bulleted', id: 'list' },
  {
    to: '/configure/devices/test',
    label: 'Input tester',
    icon: 'mdi-gesture-tap-button',
    id: 'test',
  },
  { to: '/configure/devices/health', label: 'Health check', icon: 'mdi-stethoscope', id: 'health' },
  { to: '/configure/devices/usb', label: 'USB map', icon: 'mdi-family-tree', id: 'usb' },
];
</script>

<template>
  <nav class="devices-tabs" aria-label="Device tools">
    <router-link
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="devices-tab"
      exact-active-class="active"
      :data-testid="`devices-tab-${tab.id}`"
    >
      <v-icon :icon="tab.icon" size="17" />
      {{ tab.label }}
    </router-link>
  </nav>
</template>

<style scoped>
.devices-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--rr-border);
  margin: -8px 0 20px;
}
.devices-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 9px 14px 10px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--rr-muted);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.devices-tab:hover {
  color: var(--rr-text);
}
.devices-tab.active {
  color: var(--rr-text);
  border-bottom-color: var(--rr-accent);
}
</style>
