<script setup lang="ts">
import { computed } from 'vue';
import type { Inventory } from '../core/model';
import ExternalLink from './ExternalLink.vue';
import { plural } from './store';

const props = defineProps<{ inventory: Inventory; profilesFolder: string }>();

const pluginName = computed(() => {
  const names = new Map(props.inventory.plugins.map((p) => [p.id, p.name]));
  return (id: string): string => names.get(id) ?? id;
});
const installed = (id: string): boolean =>
  props.inventory.plugins.find((p) => p.id === id)?.installed ?? false;
</script>

<template>
  <h2 class="rr-section-title">Profiles</h2>
  <div
    v-if="inventory.profiles.length === 0"
    class="rr-panel rr-empty"
    data-testid="sd-profiles-empty"
  >
    No Stream Deck profiles on this PC yet.
    <div class="rr-row-sub">
      Looked in <span class="rr-mono">{{ profilesFolder }}</span>
    </div>
  </div>
  <div v-else class="rr-panel inv-panel">
    <div
      v-for="profile in inventory.profiles"
      :key="profile.uuid"
      class="rr-row inv-profile"
      data-testid="sd-profile"
      :data-name="profile.name"
    >
      <v-icon icon="mdi-view-grid-outline" class="rr-muted" />
      <div class="rr-row-main">
        <div class="rr-row-title">{{ profile.name }}</div>
        <div class="rr-row-sub">
          {{ profile.deviceName ?? profile.deviceModel ?? 'Unknown device' }}
          <template v-if="profile.deviceConnected === true"> · connected</template>
          <template v-else-if="profile.deviceConnected === false"> · not connected</template>
          · {{ plural(profile.pages, 'page') }} · {{ plural(profile.actions, 'action') }}
        </div>
        <div v-if="profile.plugins.length" class="inv-chips">
          <span
            v-for="use in profile.plugins"
            :key="use.pluginId"
            class="inv-chip"
            :class="{ 'inv-chip-missing rr-bad': !installed(use.pluginId) }"
            :title="use.pluginId"
          >
            {{ pluginName(use.pluginId) }} <b>{{ use.actions }}</b>
          </span>
        </div>
      </div>
    </div>
  </div>

  <h2 class="rr-section-title">Plugins</h2>
  <div v-if="inventory.plugins.length === 0" class="rr-panel rr-empty">
    No plugins installed and none used.
  </div>
  <div v-else class="rr-panel inv-panel">
    <div
      v-for="plugin in inventory.plugins"
      :key="plugin.id"
      class="rr-row"
      data-testid="sd-plugin"
      :data-id="plugin.id"
      :data-installed="plugin.installed"
    >
      <v-icon
        :icon="
          plugin.builtIn
            ? 'mdi-application-outline'
            : plugin.installed
              ? 'mdi-puzzle-outline'
              : 'mdi-puzzle-remove-outline'
        "
        :class="plugin.installed ? 'rr-muted' : 'rr-bad'"
      />
      <div class="rr-row-main">
        <div class="rr-row-title">
          {{ plugin.name }}
          <span v-if="plugin.version" class="rr-muted inv-version">{{ plugin.version }}</span>
        </div>
        <div class="rr-row-sub">
          <span class="rr-mono">{{ plugin.id }}</span>
          <template v-if="plugin.author"> · {{ plugin.author }}</template>
        </div>
        <div v-if="plugin.profiles.length" class="rr-row-sub">
          Used in {{ plugin.profiles.map((p) => `${p.name} (${p.actions})`).join(', ') }}
        </div>
      </div>
      <div class="inv-count">
        <div class="rr-row-title">{{ plugin.actions.toLocaleString('en-US') }}</div>
        <div class="rr-row-sub">actions</div>
      </div>
      <div class="inv-state">
        <span v-if="plugin.builtIn" class="rr-muted">Built in</span>
        <span v-else-if="plugin.installed && plugin.actions === 0" class="rr-muted"
          >Installed, unused</span
        >
        <span v-else-if="plugin.installed" class="rr-ok">Installed</span>
        <template v-else>
          <span class="rr-bad">Not installed</span>
          <ExternalLink
            v-if="plugin.source"
            :url="plugin.source.url"
            label="Get it"
            variant="text"
            testid="sd-plugin-get"
          />
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inv-panel {
  margin-bottom: 24px;
}
.inv-profile {
  align-items: flex-start;
}
.inv-profile .v-icon {
  margin-top: 2px;
}
.inv-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.inv-chip {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
  background: var(--rr-surface-2);
  color: var(--rr-muted);
}
.inv-chip b {
  color: var(--rr-text);
  font-weight: 600;
  margin-left: 2px;
}
.inv-chip-missing {
  border: 1px solid color-mix(in srgb, var(--rr-bad) 50%, transparent);
}
.inv-version {
  font-weight: 400;
  font-size: 12.5px;
  margin-left: 6px;
}
.inv-count {
  text-align: right;
  min-width: 64px;
}
.inv-state {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 120px;
  font-size: 13px;
}
</style>
