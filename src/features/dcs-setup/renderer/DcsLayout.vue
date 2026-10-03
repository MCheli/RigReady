<script setup lang="ts">
const tabs = [
  { to: '/configure/dcs', label: 'Overview', id: 'overview' },
  { to: '/configure/dcs/screens', label: 'Screens', id: 'screens' },
  { to: '/configure/dcs/export', label: 'Export.lua', id: 'export' },
  { to: '/configure/dcs/simapppro', label: 'SimAppPro', id: 'simapppro' },
];
</script>

<template>
  <div class="rr-page dcs-page" data-testid="dcs-page">
    <h1 class="rr-page-title">DCS World</h1>
    <p class="rr-page-sub">
      Everything DCS needs from this PC apart from bindings: the install, the screens the cockpit
      displays are drawn on, the export scripts your hardware tools load, and what SimAppPro is
      still needed for.
    </p>
    <nav class="dcs-tabs" aria-label="DCS World">
      <router-link
        v-for="tab in tabs"
        :key="tab.id"
        :to="tab.to"
        class="dcs-tab"
        exact-active-class="active"
        :data-testid="`dcs-tab-${tab.id}`"
      >
        {{ tab.label }}
      </router-link>
    </nav>
    <router-view />
  </div>
</template>

<style scoped>
.dcs-page {
  max-width: 1120px;
}
.dcs-tabs {
  display: flex;
  gap: 2px;
  border-bottom: 1px solid var(--rr-border);
  margin: -8px 0 24px;
}
.dcs-tab {
  padding: 8px 14px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--rr-muted);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.dcs-tab:hover {
  color: var(--rr-text);
}
.dcs-tab.active {
  color: var(--rr-text);
  border-bottom-color: var(--rr-accent);
}
</style>
